import { ForbiddenException, Injectable, Inject, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout, catchError, of } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import {
  ORDER_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { CreateReviewDto } from "./dto/review.dto";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import {
  CreateProductDto,
  UpdateProductDto,
  GetProductsQueryDto,
  CreateBrandDto,
  ReviewBrandDto,
  CreateCategoryDto,
  ReviewCategoryDto,
} from "./dto";
import { CreateSkuGatewayDto, UpdateSkuGatewayDto } from "./dto/product.dto";
import { PaginatedResponse } from "@app/common";

export interface ProductWithInventory {
  // Product fields
  id: number;
  name: string;
  description?: string;
  price: number;
  stockQuantity: number;
  sku: string;
  brandId?: number;
  userId?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  brand?: unknown;
  categories: unknown[];

  // User information
  user?: {
    id: number;
    name: string;
    email?: string;
    avatar?: string;
  };

  // Inventory fields
  inventory?: {
    id: number;
    productId: number;
    sku: string;
    availableStock: number;
    reservedStock: number;
    minimumStock: number;
    location?: string;
    isActive: boolean;
    totalStock: number;
    isLowStock: boolean;
  } | null;
}

type ProductData = {
  id?: string | number;
  userId?: string | number;
  name?: string;
  items?: ProductData[];
  data?: ProductData | ProductData[];
  [key: string]: unknown;
};

type InventoryData = {
  productId?: number;
  availableStock?: number;
  reservedStock?: number;
  minimumStock?: number;
  updatedAt?: unknown;
  [key: string]: unknown;
};

type UserData = {
  id?: number;
  name?: string;
  username?: string;
  email?: string;
  avatar?: string;
};

type SkuOwnershipData = {
  id: number;
  productId: number;
};

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  constructor(
    @Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE)
    private readonly productClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.INVENTORY_SERVICE)
    private readonly inventoryClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.ORDERS_SERVICE)
    private readonly ordersClient: ClientProxy,
  ) {}

  // ============================================================================
  // PRODUCT OPERATIONS
  // ============================================================================

  async createProduct(dto: CreateProductDto, userId: number): Promise<unknown> {
    try {
      this.logger.log(`Creating product with SKU: ${dto.sku}`);
      const response = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_CREATE, { ...dto, userId })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as ProductData;

      // Extract result from response wrapper
      const result =
        response?.items?.[0] ??
        (response?.data as ProductData | undefined) ??
        response;
      this.logger.log(
        `Product created successfully with ID: ${String(result?.id ?? "")}`,
      );

      // Skip auto-inventory for SKU-matrix products — inventory is managed
      // per-SKU asynchronously via the sku_upserted event.
      if (result?.id && !dto.skuList?.length) {
        try {
          await firstValueFrom(
            this.inventoryClient
              .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CREATE, {
                productId: Number(result.id),
                sku: dto.sku,
                availableStock: dto.stockQuantity ?? 0,
                minimumStock: 0,
              })
              .pipe(timeout(10000)),
          );
          this.logger.log(
            `Inventory created for product ID: ${String(result.id)}`,
          );
        } catch (invErr) {
          // Saga compensation: product and inventory live in separate service
          // DBs, so we cannot use a single transaction. If inventory creation
          // fails, roll back the just-created product so the caller never ends
          // up with an orphan product showing stock 0. A retry then starts clean.
          this.logger.error(
            `Inventory creation failed for product ${String(result.id)} — rolling back product`,
            invErr instanceof Error ? invErr.stack : String(invErr),
          );
          await this.compensateProductCreate(Number(result.id));
          throw invErr;
        }
      }

      return result;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create product",
        "Product Service",
      );
    }
  }

  /**
   * Ensure a product object carries a flat `categoryIds: number[]` derived from
   * its hydrated `categories[]` relation. The product service already returns
   * the full `categories[]` (eager ManyToMany) on every read path, but only
   * `getProductById` historically exposed the flat id list — the FE needs it
   * uniformly to drive the shop table's multi-category editor (P1-04).
   */
  private attachCategoryIds<T extends object>(
    product: T,
  ): T & { categoryIds: number[] } {
    const categories = (product as { categories?: { id: number | string }[] })
      .categories;
    return {
      ...product,
      categoryIds: Array.isArray(categories)
        ? categories.map((category) => Number(category.id))
        : [],
    };
  }

  /**
   * Apply `attachCategoryIds` across whatever shape a product read returns: a
   * bare product, an array of products, or a paginated `{ data | items: [] }`
   * envelope. Used by the raw pass-through read paths (by-category, by-brand,
   * search, by-sku) that do not run user enrichment.
   */
  private withCategoryIds(response: unknown): unknown {
    if (Array.isArray(response)) {
      return (response as unknown[]).map((item) =>
        item && typeof item === "object" ? this.attachCategoryIds(item) : item,
      );
    }
    if (response && typeof response === "object") {
      const envelope = response as { data?: unknown; items?: unknown };
      if (Array.isArray(envelope.data)) {
        return { ...envelope, data: this.withCategoryIds(envelope.data) };
      }
      if (Array.isArray(envelope.items)) {
        return { ...envelope, items: this.withCategoryIds(envelope.items) };
      }
      return this.attachCategoryIds(response);
    }
    return response;
  }

  /**
   * Fetch a single page of products from the product service and enrich it
   * with user info, preserving the pagination metadata (total/page/limit)
   * returned by the microservice.
   */
  private async fetchProductsPage(query: GetProductsQueryDto): Promise<{
    items: ProductData[];
    total: number;
    page: number;
    limit: number;
  }> {
    const response = (await firstValueFrom(
      this.productClient
        .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_ALL, query)
        .pipe(
          timeout(10000),
          catchError((err: unknown) => {
            throw err;
          }),
        ),
    )) as ProductData;

    // Extract products from response structure
    const products =
      response?.items ??
      (response?.data as ProductData[] | undefined) ??
      response ??
      [];
    const productsArr = Array.isArray(products) ? products : [];

    // Enrich with user info, then expose a flat categoryIds[] uniformly (P1-04)
    const enrichedProducts = (
      await this.enrichProductsWithUserInfo(productsArr)
    ).map((product) => this.attachCategoryIds(product));

    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 10);
    const total =
      typeof response?.total === "number"
        ? response.total
        : enrichedProducts.length;

    return { items: enrichedProducts, total, page, limit };
  }

  async getAllProducts(query: GetProductsQueryDto): Promise<unknown> {
    try {
      this.logger.log(
        `Fetching all products with query: ${JSON.stringify(query)}`,
      );

      const { items } = await this.fetchProductsPage(query);

      this.logger.log(`Found ${items.length} products with user info`);
      return items;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "fetch products",
        "Product Service",
      );
    }
  }

  async getProductById(id: number): Promise<unknown> {
    try {
      this.logger.log(`Fetching product by ID: ${id}`);
      const response = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID, id)
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as ProductData;

      // Extract product from response wrapper
      const product =
        response?.items?.[0] ??
        (response?.data as ProductData | undefined) ??
        response;
      this.logger.debug(
        `Product ${id} response:`,
        product ? "found" : "not found",
      );

      // Enrich with user information, then expose a flat categoryIds[] (P1-04)
      const enriched = await this.enrichProductWithUserInfo(product);
      return this.attachCategoryIds(enriched);
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `fetch product by ID: ${id}`,
        "Product Service",
      );
    }
  }

  async getProductBySku(sku: string): Promise<unknown> {
    try {
      const response = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_SKU, sku)
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
      return this.withCategoryIds(response);
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `fetch product by SKU: ${sku}`,
        "Product Service",
      );
    }
  }

  async updateProduct(
    id: number,
    dto: UpdateProductDto,
    callerId: number,
    callerRole: string,
  ): Promise<unknown> {
    await this.assertProductMutationAccess(id, callerId, callerRole);
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_UPDATE, {
            id,
            updateProductDto: dto,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `update product ID: ${id}`,
        "Product Service",
      );
    }
  }

  async deleteProduct(
    id: number,
    callerId: number,
    callerRole: string,
  ): Promise<unknown> {
    await this.assertProductMutationAccess(id, callerId, callerRole);
    let result: unknown;
    try {
      result = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_DELETE, id)
          .pipe(timeout(10000)),
        { defaultValue: { success: true } },
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `delete product ID: ${id}`,
        "Product Service",
      );
    }

    // Clean up inventory in the separate inventory-service DB (no cross-DB
    // cascade). Hard-deleting here prevents stale rows from re-attaching to a
    // future product that reuses this ID. Best-effort: the product is already
    // gone, so a failure is logged rather than surfaced.
    await this.cleanupInventoryForProduct(id);

    return result;
  }

  private async compensateProductCreate(productId: number): Promise<void> {
    try {
      await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_DELETE, productId)
          .pipe(timeout(10000)),
        { defaultValue: { success: true } },
      );
      this.logger.log(
        `Compensation: rolled back product ${productId} after inventory failure`,
      );
    } catch (err) {
      this.logger.error(
        `Compensation failed: could not roll back product ${productId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async cleanupInventoryForProduct(productId: number): Promise<void> {
    try {
      await firstValueFrom(
        this.inventoryClient
          .send(
            INVENTORY_MESSAGE_PATTERNS.INVENTORY_REMOVE_BY_PRODUCT,
            productId,
          )
          .pipe(timeout(10000)),
      );
      this.logger.log(`Inventory cleaned up for deleted product ${productId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to clean up inventory for deleted product ${productId}: ${String(err)}`,
      );
    }
  }

  // ============================================================================
  // SKU OPERATIONS
  // ============================================================================

  async getSkusByProduct(productId: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.SKU_FIND_BY_PRODUCT, productId)
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `fetch SKUs for product ID: ${productId}`,
        "Product Service",
      );
    }
  }

  async addSku(
    productId: number,
    dto: CreateSkuGatewayDto,
    callerId: number,
    callerRole: string,
  ): Promise<unknown> {
    await this.assertProductMutationAccess(productId, callerId, callerRole);
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.SKU_CREATE, {
            productId,
            skuList: [dto],
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `add SKU to product ID: ${productId}`,
        "Product Service",
      );
    }
  }

  async updateSku(
    productId: number,
    skuId: number,
    dto: UpdateSkuGatewayDto,
    callerId: number,
    callerRole: string,
  ): Promise<unknown> {
    await this.assertProductMutationAccess(productId, callerId, callerRole);
    await this.assertSkuBelongsToProduct(skuId, productId);
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.SKU_UPDATE, { id: skuId, dto })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `update SKU ID: ${skuId}`,
        "Product Service",
      );
    }
  }

  async deleteSku(
    productId: number,
    skuId: number,
    callerId: number,
    callerRole: string,
  ): Promise<unknown> {
    await this.assertProductMutationAccess(productId, callerId, callerRole);
    await this.assertSkuBelongsToProduct(skuId, productId);
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.SKU_DELETE, skuId)
          .pipe(timeout(10000)),
        { defaultValue: { success: true } },
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `delete SKU ID: ${skuId}`,
        "Product Service",
      );
    }
  }

  private async assertProductMutationAccess(
    productId: number,
    callerId: number,
    callerRole: string,
  ): Promise<void> {
    if (callerRole === "admin") {
      return;
    }

    const product = await this.fetchProductForAccess(productId);
    if (Number(product.userId) !== callerId) {
      throw new ForbiddenException("You cannot modify another user's product");
    }
  }

  private async assertSkuBelongsToProduct(
    skuId: number,
    productId: number,
  ): Promise<void> {
    try {
      const sku = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.SKU_FIND_BY_ID, skuId)
          .pipe(timeout(10000)),
      )) as SkuOwnershipData;
      if (Number(sku.productId) !== productId) {
        throw new ForbiddenException("SKU does not belong to this product");
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      MicroserviceErrorHandler.handleError(
        error,
        `verify SKU ID: ${skuId}`,
        "Product Service",
      );
    }
  }

  private async fetchProductForAccess(productId: number): Promise<ProductData> {
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID, productId)
          .pipe(timeout(10000)),
      )) as ProductData;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `verify product ID: ${productId}`,
        "Product Service",
      );
    }
  }

  async getProductsByCategory(
    categoryId: number,
    query: GetProductsQueryDto,
  ): Promise<unknown> {
    const response = (await firstValueFrom(
      this.productClient.send(
        PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_CATEGORY,
        { categoryId, query },
      ),
    )) as unknown;
    return this.withCategoryIds(response);
  }

  async getProductsByBrand(
    brandId: number,
    query: GetProductsQueryDto,
  ): Promise<unknown> {
    const response = (await firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_BRAND, {
        brandId,
        query,
      }),
    )) as unknown;
    return this.withCategoryIds(response);
  }

  async searchProducts(query: GetProductsQueryDto): Promise<unknown> {
    const response = (await firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_SEARCH, query),
    )) as unknown;
    return this.withCategoryIds(response);
  }

  // ============================================================================
  // BRAND OPERATIONS
  // ============================================================================

  async createBrand(dto: CreateBrandDto, userId: number): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient
        .send(PRODUCT_MESSAGE_PATTERNS.BRAND_CREATE, {
          ...dto,
          submittedBy: userId,
        })
        .pipe(timeout(10000)),
    )) as unknown;
  }

  async getAllBrands(): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient
        .send(PRODUCT_MESSAGE_PATTERNS.BRAND_FIND_ALL, {})
        .pipe(timeout(10000)),
    )) as unknown;
  }

  async getPendingBrands(): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient
        .send(PRODUCT_MESSAGE_PATTERNS.BRAND_FIND_ALL, { status: "pending" })
        .pipe(timeout(10000)),
    )) as unknown;
  }

  async reviewBrand(id: number, dto: ReviewBrandDto): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.BRAND_REVIEW, {
            id,
            action: dto.action,
            note: dto.note,
          })
          .pipe(timeout(10000)),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `review brand ID: ${id}`,
        "Product Service",
      );
    }
  }

  async getBrandById(id: number): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient
        .send(PRODUCT_MESSAGE_PATTERNS.BRAND_FIND_BY_ID, id)
        .pipe(timeout(10000)),
    )) as unknown;
  }

  // ============================================================================
  // CATEGORY OPERATIONS
  // ============================================================================

  async createCategory(
    dto: CreateCategoryDto,
    userId: number,
  ): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient
        .send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_CREATE, {
          ...dto,
          submittedBy: userId,
        })
        .pipe(timeout(10000)),
    )) as unknown;
  }

  async getAllCategories(): Promise<unknown> {
    try {
      this.logger.log("Fetching all categories");
      const result = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_FIND_ALL, {})
          .pipe(timeout(10000)),
      )) as unknown as unknown[];
      this.logger.log(`Found ${result?.length ?? 0} categories`);
      return result;
    } catch (error) {
      this.logger.error("Failed to fetch categories:", error);
      throw error;
    }
  }

  async getPendingCategories(): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient
        .send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_FIND_ALL, { status: "pending" })
        .pipe(timeout(10000)),
    )) as unknown;
  }

  async reviewCategory(id: number, dto: ReviewCategoryDto): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_REVIEW, {
            id,
            action: dto.action,
            note: dto.note,
          })
          .pipe(timeout(10000)),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `review category ID: ${id}`,
        "Product Service",
      );
    }
  }

  async getCategoryById(id: number): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient
        .send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_FIND_BY_ID, id)
        .pipe(timeout(10000)),
    )) as unknown;
  }

  // ============================================================================
  // AGGREGATOR OPERATIONS - PRODUCT + INVENTORY
  // ============================================================================

  async getProductWithInventoryById(
    productId: number,
  ): Promise<ProductWithInventory | null> {
    try {
      this.logger.debug(`Aggregating data for product ID: ${productId}`);

      // Fetch product and inventory data in parallel (Aggregator Pattern)
      const [product, inventory] = (await Promise.all([
        this.getProductById(productId).catch((err: unknown) => {
          this.logger.warn(
            `Product service error for ID ${productId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }),
        firstValueFrom(
          this.inventoryClient.send(
            INVENTORY_MESSAGE_PATTERNS.INVENTORY_FIND_BY_PRODUCT_ID,
            productId,
          ),
        ).catch((err: unknown) => {
          this.logger.warn(
            `Inventory service error for product ID ${productId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }),
      ])) as [unknown, unknown];

      // If product doesn't exist, return null
      if (!product) {
        this.logger.debug(`Product not found for ID: ${productId}`);
        return null;
      }

      // Enrich product with user information
      const enrichedProduct = await this.enrichProductWithUserInfo(
        product as ProductData,
      );

      // Data aggregation and enrichment (with flat categoryIds[] — P1-04)
      const result: ProductWithInventory = {
        ...(this.attachCategoryIds(
          enrichedProduct,
        ) as unknown as ProductWithInventory),
        inventory: inventory
          ? (this.enrichInventoryData(
              inventory as InventoryData,
            ) as unknown as ProductWithInventory["inventory"])
          : null,
      };

      this.logger.debug(
        `Successfully aggregated data for product ID: ${productId}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Aggregation failed for product ID ${productId}:`,
        error,
      );
      throw error;
    }
  }

  private enrichInventoryData(inventory: InventoryData) {
    return {
      ...inventory,
      totalStock:
        (inventory.availableStock ?? 0) + (inventory.reservedStock ?? 0),
      isLowStock:
        (inventory.availableStock ?? 0) <= (inventory.minimumStock ?? 0),
      stockStatus: this.getStockStatus(inventory),
      lastUpdated: inventory.updatedAt,
    };
  }

  private getStockStatus(inventory: InventoryData): string {
    if ((inventory.availableStock ?? 0) === 0) return "OUT_OF_STOCK";
    if ((inventory.availableStock ?? 0) <= (inventory.minimumStock ?? 0))
      return "LOW_STOCK";
    if ((inventory.availableStock ?? 0) > (inventory.minimumStock ?? 0) * 3)
      return "IN_STOCK";
    return "NORMAL_STOCK";
  }

  /**
   * Aggregate shop-wide inventory stats for a seller, independent of any
   * product-list pagination. Two bounded TCP calls (seller product IDs +
   * batch inventory) — never an N+1 per-product fan-out.
   */
  async getShopStats(sellerId: number): Promise<{
    productCount: number;
    totalStock: number;
    lowStockCount: number;
  }> {
    try {
      const productIds = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.GET_PRODUCT_IDS_BY_SELLER, sellerId)
          .pipe(timeout(10000)),
      )) as number[];

      if (!productIds || productIds.length === 0) {
        return { productCount: 0, totalStock: 0, lowStockCount: 0 };
      }

      const inventoryItems = (await firstValueFrom(
        this.inventoryClient
          .send(
            INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_BY_PRODUCT_IDS,
            productIds,
          )
          .pipe(timeout(10000)),
      )) as InventoryData[];

      let totalStock = 0;
      const lowStockProductIds = new Set<number>();
      if (Array.isArray(inventoryItems)) {
        for (const item of inventoryItems) {
          const available = item.availableStock ?? 0;
          totalStock += available;
          if (
            item.productId !== undefined &&
            available <= (item.minimumStock ?? 0)
          ) {
            lowStockProductIds.add(item.productId);
          }
        }
      }

      return {
        productCount: productIds.length,
        totalStock,
        lowStockCount: lowStockProductIds.size,
      };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `get shop stats for seller ${sellerId}`,
        "Product Service",
      );
    }
  }

  async getProductsWithInventory(
    productIds: number[],
  ): Promise<ProductWithInventory[]> {
    try {
      if (!productIds || productIds.length === 0) {
        return [];
      }

      // Fetch products and inventory data in parallel. Inventory is optional
      // context — if the inventory service is unavailable we degrade to
      // `inventory: null` instead of failing the whole request with a raw 500.
      const [products, inventoryItems] = (await Promise.all([
        Promise.all(
          productIds.map((id) =>
            this.getProductById(id).catch((err: unknown) => {
              this.logger.warn(
                `Product service error for ID ${id}: ${err instanceof Error ? err.message : String(err)}`,
              );
              return null;
            }),
          ),
        ),
        firstValueFrom(
          this.inventoryClient
            .send(
              INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_BY_PRODUCT_IDS,
              productIds,
            )
            .pipe(timeout(10000)),
        ).catch((err: unknown) => {
          this.logger.warn(
            `Inventory service error for product IDs [${productIds.join(", ")}]: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [] as InventoryData[];
        }),
      ])) as [unknown[], unknown];
      const typedInventoryItems = inventoryItems as InventoryData[];

      // Create inventory map for quick lookup
      const inventoryMap = new Map<number, InventoryData>();
      if (typedInventoryItems && Array.isArray(typedInventoryItems)) {
        typedInventoryItems.forEach((item) => {
          if (item.productId !== undefined) {
            inventoryMap.set(item.productId, {
              ...item,
              totalStock:
                (item.availableStock ?? 0) + (item.reservedStock ?? 0),
              isLowStock:
                (item.availableStock ?? 0) <= (item.minimumStock ?? 0),
            });
          }
        });
      }

      // Enrich products with user information
      const validProducts = products.filter((p) => p !== null) as ProductData[];
      const enrichedProducts =
        await this.enrichProductsWithUserInfo(validProducts);

      // Combine products with their inventory data
      const results = enrichedProducts.map((product) => ({
        ...(product as unknown as ProductWithInventory),
        inventory:
          (inventoryMap.get(
            product.id as number,
          ) as unknown as ProductWithInventory["inventory"]) ?? null,
      })) as ProductWithInventory[];

      return results;
    } catch (error) {
      this.logger.error(`Error fetching products with inventory:`, error);
      throw error;
    }
  }

  async getAllProductsWithInventory(
    query: GetProductsQueryDto,
  ): Promise<PaginatedResponse<ProductWithInventory>> {
    try {
      // Fetch the requested page of products (preserving pagination metadata)
      const {
        items: products,
        total,
        page,
        limit,
      } = await this.fetchProductsPage(query);

      if (!products || products.length === 0) {
        return PaginatedResponse.of<ProductWithInventory>(
          [],
          total,
          page,
          limit,
        );
      }

      // Extract product IDs
      const productIds = products.map((product) => product.id as number);

      // Fetch inventory data for the page in a single batch TCP call
      const inventoryItems = (await firstValueFrom(
        this.inventoryClient.send(
          INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_BY_PRODUCT_IDS,
          productIds,
        ),
      )) as unknown as InventoryData[];

      // Create inventory map
      const inventoryMap = new Map<number, InventoryData>();
      if (inventoryItems && Array.isArray(inventoryItems)) {
        inventoryItems.forEach((item) => {
          if (item.productId !== undefined) {
            inventoryMap.set(item.productId, {
              ...item,
              totalStock:
                (item.availableStock ?? 0) + (item.reservedStock ?? 0),
              isLowStock:
                (item.availableStock ?? 0) <= (item.minimumStock ?? 0),
            });
          }
        });
      }

      // Combine products with inventory
      const results = products.map((product) => ({
        ...(product as unknown as ProductWithInventory),
        inventory:
          (inventoryMap.get(
            product.id as number,
          ) as unknown as ProductWithInventory["inventory"]) ?? null,
      })) as ProductWithInventory[];

      return PaginatedResponse.of(results, total, page, limit);
    } catch (error) {
      this.logger.error(`Error fetching all products with inventory:`, error);
      throw error;
    }
  }

  async checkProductStock(
    productId: number,
    quantity: number,
  ): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.inventoryClient.send(
          INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK,
          { productId, quantity },
        ),
      )) as unknown;
    } catch (error) {
      this.logger.error(
        `Error checking stock for product ${productId}:`,
        error,
      );
      throw error;
    }
  }

  // ============================================================================
  // REVIEW OPERATIONS
  // ============================================================================

  async createProductReview(
    productId: number,
    userId: number,
    dto: CreateReviewDto,
  ): Promise<unknown> {
    try {
      await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.VERIFY_PRODUCT_PURCHASED, {
            userId,
            productId,
          })
          .pipe(timeout(10000)),
      );
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.REVIEW_CREATE, {
            userId,
            productId,
            rating: dto.rating,
            comment: dto.comment,
          })
          .pipe(timeout(10000)),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `create review for product ID: ${productId}`,
        "Product Service",
      );
    }
  }

  async deleteProductReview(reviewId: number, userId: number): Promise<void> {
    try {
      await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.REVIEW_DELETE, { reviewId, userId })
          .pipe(timeout(10000)),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `delete review ID: ${reviewId}`,
        "Product Service",
      );
    }
  }

  async getProductReviews(
    productId: number,
    page: number,
    limit: number,
  ): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.REVIEW_FIND_BY_PRODUCT, {
            productId,
            page,
            limit,
          })
          .pipe(timeout(10000)),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `get reviews for product ID: ${productId}`,
        "Product Service",
      );
    }
  }

  // ============================================================================
  // USER INFORMATION ENRICHMENT
  // ============================================================================

  private async enrichProductWithUserInfo(
    product: ProductData,
  ): Promise<ProductData> {
    if (!product || typeof product !== "object" || !product.userId) {
      this.logger.debug(
        `Skipping user enrichment for product: ${String(product?.id ?? "unknown")}`,
      );
      return product;
    }

    try {
      const userId = parseInt(String(product.userId));
      if (isNaN(userId)) {
        this.logger.warn(
          `Invalid userId for product ${String(product.id ?? "")}: ${String(product.userId)}`,
        );
        return product;
      }

      this.logger.debug(`Fetching single user info for userId: ${userId}`);
      const user = (await firstValueFrom(
        this.userClient
          .send({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, userId)
          .pipe(
            timeout(5000),
            catchError((err: unknown) => {
              this.logger.warn(
                `Failed to fetch user info for userId: ${userId}`,
                err instanceof Error ? err.message : String(err),
              );
              return of(null);
            }),
          ),
      )) as UserData | null;
      this.logger.debug(`Single user response for userId ${userId}:`, user);

      return {
        ...product,
        user: user
          ? {
              id: user.id,
              name: user.username,
              email: user.email,
              avatar: user.avatar,
            }
          : null,
      };
    } catch (error) {
      this.logger.debug(
        `User enrichment failed for product ${String(product.id ?? "")}, userId: ${String(product.userId ?? "")}`,
        error instanceof Error ? error.message : String(error),
      );
      return product;
    }
  }

  private async enrichProductsWithUserInfo(
    products: ProductData[],
  ): Promise<ProductData[]> {
    // Validate input is array
    if (!Array.isArray(products) || products.length === 0) {
      this.logger.debug("Invalid or empty products array for user enrichment");
      return Array.isArray(products) ? products : [];
    }

    try {
      // Get unique user IDs (convert string to number)
      const userIds = [
        ...new Set(
          products
            .filter((product) => product && product.userId)
            .map((product) => parseInt(String(product.userId))),
        ),
      ].filter((id) => !isNaN(id));

      if (userIds.length === 0) {
        return products;
      }

      // Fetch user information for all unique user IDs
      this.logger.debug(
        `Fetching user info for userIds: ${JSON.stringify(userIds)}`,
      );
      const users = await Promise.all(
        userIds.map(async (userId) => {
          try {
            this.logger.debug(`Calling User service for userId: ${userId}`);
            const user = (await firstValueFrom(
              this.userClient
                .send({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, userId)
                .pipe(
                  timeout(5000),
                  catchError((err: unknown) => {
                    this.logger.warn(
                      `Failed to fetch user info for userId: ${userId}`,
                      err instanceof Error ? err.message : String(err),
                    );
                    return of(null);
                  }),
                ),
            )) as UserData | null;
            this.logger.debug(
              `User service response for userId ${userId}:`,
              user,
            );
            return { userId, user };
          } catch (error) {
            this.logger.error(`Error fetching user ${userId}:`, error);
            return { userId, user: null as UserData | null };
          }
        }),
      );

      // Create user map for quick lookup
      const userMap = new Map<number, UserData>();
      users.forEach(({ userId, user }) => {
        if (user) {
          userMap.set(userId, {
            id: user.id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
          });
        }
      });

      // Enrich products with user information
      return products.map((product) => ({
        ...product,
        user: product.userId
          ? (userMap.get(parseInt(String(product.userId))) ?? null)
          : null,
      }));
    } catch (error) {
      this.logger.error("Error enriching products with user info:", error);
      // Return original products if enrichment fails
      return products;
    }
  }
}
