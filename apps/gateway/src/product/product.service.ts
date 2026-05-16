import { Injectable, Inject, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout, catchError, of } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { USER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import {
  CreateProductDto,
  UpdateProductDto,
  GetProductsQueryDto,
  CreateBrandDto,
  CreateCategoryDto,
} from "./dto/product-simple.dto";

export interface ProductWithInventory {
  // Product fields
  id: number;
  name: string;
  description?: string;
  price: number;
  stockQuantity: number;
  sku: string;
  brandId?: number;
  categoryId: number;
  userId?: number;
  imageUrl?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  brand?: unknown;
  category: unknown;

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
  ) {}

  // ============================================================================
  // PRODUCT OPERATIONS
  // ============================================================================

  async createProduct(dto: CreateProductDto): Promise<unknown> {
    try {
      this.logger.log(`Creating product with SKU: ${dto.sku}`);
      const response = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_CREATE, dto)
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

      if (result?.id) {
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
          this.logger.warn(
            `Failed to create inventory for product ${String(result.id)}: ${String(invErr)}`,
          );
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

  async getAllProducts(query: GetProductsQueryDto): Promise<unknown> {
    try {
      this.logger.log(
        `Fetching all products with query: ${JSON.stringify(query)}`,
      );
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

      // Debug logging
      this.logger.debug(
        `Raw response from product service:`,
        JSON.stringify(response, null, 2),
      );

      // Extract products from response structure
      const products =
        response?.items ??
        (response?.data as ProductData[] | undefined) ??
        response ??
        [];
      const productsArr = Array.isArray(products) ? products : [];
      this.logger.debug(
        `Extracted products type: ${typeof products}, isArray: ${Array.isArray(products)}, length: ${productsArr.length}`,
      );

      // Enrich products with user information
      const enrichedProducts =
        await this.enrichProductsWithUserInfo(productsArr);

      this.logger.log(
        `Found ${enrichedProducts.length} products with user info`,
      );
      return enrichedProducts;
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

      // Enrich with user information
      return await this.enrichProductWithUserInfo(product);
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
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_SKU, sku)
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
        `fetch product by SKU: ${sku}`,
        "Product Service",
      );
    }
  }

  async updateProduct(id: number, dto: UpdateProductDto): Promise<unknown> {
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

  async deleteProduct(id: number): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_DELETE, id),
    )) as unknown;
  }

  async getProductsByCategory(
    categoryId: number,
    query: GetProductsQueryDto,
  ): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient.send(
        PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_CATEGORY,
        { categoryId, query },
      ),
    )) as unknown;
  }

  async getProductsByBrand(
    brandId: number,
    query: GetProductsQueryDto,
  ): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_BRAND, {
        brandId,
        query,
      }),
    )) as unknown;
  }

  async searchProducts(query: GetProductsQueryDto): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_SEARCH, query),
    )) as unknown;
  }

  // ============================================================================
  // BRAND OPERATIONS
  // ============================================================================

  async createBrand(dto: CreateBrandDto): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGE_PATTERNS.BRAND_CREATE, dto),
    )) as unknown;
  }

  async getAllBrands(): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGE_PATTERNS.BRAND_FIND_ALL, {}),
    )) as unknown;
  }

  async getBrandById(id: number): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGE_PATTERNS.BRAND_FIND_BY_ID, id),
    )) as unknown;
  }

  // ============================================================================
  // CATEGORY OPERATIONS
  // ============================================================================

  async createCategory(dto: CreateCategoryDto): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_CREATE, dto),
    )) as unknown;
  }

  async getAllCategories(): Promise<unknown> {
    try {
      this.logger.log("Fetching all categories");
      const result = (await firstValueFrom(
        this.productClient.send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_FIND_ALL, {}),
      )) as unknown as unknown[];
      this.logger.log(`Found ${result?.length ?? 0} categories`);
      return result;
    } catch (error) {
      this.logger.error("Failed to fetch categories:", error);
      throw error;
    }
  }

  async getCategoryById(id: number): Promise<unknown> {
    return (await firstValueFrom(
      this.productClient.send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_FIND_BY_ID, id),
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

      // Data aggregation and enrichment
      const result: ProductWithInventory = {
        ...(enrichedProduct as unknown as ProductWithInventory),
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

  async getProductsWithInventory(
    productIds: number[],
  ): Promise<ProductWithInventory[]> {
    try {
      if (!productIds || productIds.length === 0) {
        return [];
      }

      // Fetch products and inventory data in parallel
      const [products, inventoryItems] = (await Promise.all([
        Promise.all(productIds.map((id) => this.getProductById(id))),
        firstValueFrom(
          this.inventoryClient.send(
            INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_BY_PRODUCT_IDS,
            productIds,
          ),
        ),
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
  ): Promise<ProductWithInventory[]> {
    try {
      // Fetch all products first
      const products = (await this.getAllProducts(query)) as
        | ProductData[]
        | null;

      if (!products || products.length === 0) {
        return [];
      }

      // Extract product IDs
      const productIds = products.map((product) => product.id as number);

      // Fetch inventory data for all products
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

      return results;
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
