import { ForbiddenException, Injectable, Inject, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout, catchError, of } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { PRODUCT_MESSAGE } from "libs/constant/response-message.constant";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import {
  ORDER_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { CreateReviewDto } from "./dto/review.dto";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { assertCloudinaryUrlsOwnedBy } from "../common/media/cloudinary-ownership";
import {
  CreateProductDto,
  UpdateProductDto,
  GetProductsQueryDto,
  CreateBrandDto,
  ReviewBrandDto,
  CreateCategoryDto,
  ReviewCategoryDto,
  WishlistQueryDto,
  PriceSuggestionQueryDto,
  ProductRiskQueryDto,
  ProductRiskBackfillDto,
} from "./dto";
import { PaginatedResponse } from "@app/common";
import {
  InventoryData,
  ProductData,
  ProductWithInventory,
  UserData,
  PriceSuggestion,
  ProductRiskSummary,
  ProductRiskBackfillResult,
  ProductDuplicateAdvisory,
  ProductRiskFeedbackResult,
} from "./product.types";

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

  private exposeProductPayload(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.exposeProductPayload(item));
    }
    if (!value || typeof value !== "object") {
      return value;
    }
    const raw = value as Record<string, unknown>;
    const exposed: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(raw)) {
      if (key !== "publicId") {
        exposed[key] = this.exposeProductPayload(nestedValue);
      }
    }
    if (typeof raw.publicId === "string" && raw.id !== undefined) {
      exposed.id = raw.publicId;
    }
    return exposed;
  }

  private async exposeUserReferences(value: unknown): Promise<unknown> {
    const userReferenceKeys = new Set([
      "userId",
      "sellerId",
      "submittedBy",
      "reviewerId",
      "resolvedBy",
    ]);
    const userIds = new Set<number>();
    const collect = (nested: unknown): void => {
      if (Array.isArray(nested)) {
        nested.forEach(collect);
        return;
      }
      if (!nested || typeof nested !== "object") return;
      for (const [key, nestedValue] of Object.entries(
        nested as Record<string, unknown>,
      )) {
        if (
          userReferenceKeys.has(key) &&
          nestedValue !== null &&
          Number.isFinite(Number(nestedValue))
        ) {
          userIds.add(Number(nestedValue));
        }
        collect(nestedValue);
      }
    };
    collect(value);
    if (userIds.size === 0) return value;
    const users = (await firstValueFrom(
      this.userClient
        .send(
          { cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS },
          { userIds: [...userIds] },
        )
        .pipe(timeout(10000)),
    )) as Array<{ id: number; publicId?: string | null }>;
    const publicIdById = new Map(
      users.map((user) => [Number(user.id), user.publicId ?? null]),
    );
    const expose = (nested: unknown): unknown => {
      if (Array.isArray(nested)) return nested.map(expose);
      if (!nested || typeof nested !== "object") return nested;
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>).map(
          ([key, nestedValue]) => [
            key,
            userReferenceKeys.has(key) && nestedValue !== null
              ? (publicIdById.get(Number(nestedValue)) ?? null)
              : expose(nestedValue),
          ],
        ),
      );
    };
    return expose(value);
  }

  private async exposeProductReferences(value: unknown): Promise<unknown> {
    const productIds = new Set<number>();
    const collect = (nested: unknown): void => {
      if (Array.isArray(nested)) {
        nested.forEach(collect);
        return;
      }
      if (!nested || typeof nested !== "object") return;
      for (const [key, nestedValue] of Object.entries(
        nested as Record<string, unknown>,
      )) {
        if (
          (key === "productId" || key === "matchedProductId") &&
          (typeof nestedValue === "number" ||
            typeof nestedValue === "string") &&
          Number.isFinite(Number(nestedValue))
        ) {
          productIds.add(Number(nestedValue));
        }
        collect(nestedValue);
      }
    };
    collect(value);
    if (productIds.size === 0) {
      return this.exposeUserReferences(this.exposeProductPayload(value));
    }
    const products = await firstValueFrom(
      this.productClient
        .send<
          ProductData[]
        >(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS, [...productIds])
        .pipe(timeout(10000)),
    );
    const publicIdById = new Map(
      products.map((product) => [Number(product.id), product.publicId ?? null]),
    );
    const expose = (nested: unknown): unknown => {
      if (Array.isArray(nested)) return nested.map(expose);
      if (!nested || typeof nested !== "object") return nested;
      const raw = nested as Record<string, unknown>;
      const exposed: Record<string, unknown> = {};
      for (const [key, nestedValue] of Object.entries(raw)) {
        if (key === "publicId") continue;
        if (
          (key === "productId" || key === "matchedProductId") &&
          Number.isFinite(Number(nestedValue))
        ) {
          exposed[key] = publicIdById.get(Number(nestedValue)) ?? null;
        } else {
          exposed[key] = expose(nestedValue);
        }
      }
      if (typeof raw.publicId === "string" && raw.id !== undefined) {
        exposed.id = raw.publicId;
      }
      return exposed;
    };
    return this.exposeUserReferences(expose(value));
  }

  private async resolveProductQuery(
    query: GetProductsQueryDto,
  ): Promise<Omit<GetProductsQueryDto, "userId"> & { userId?: number }> {
    const { userId, ...queryWithoutUserId } = query;
    if (!userId) return queryWithoutUserId;
    const user = await firstValueFrom(
      this.userClient
        .send<{
          id: number;
        }>({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, { userId })
        .pipe(timeout(10000)),
    );
    return { ...queryWithoutUserId, userId: Number(user.id) };
  }

  // ============================================================================
  // PRODUCT OPERATIONS
  // ============================================================================

  async getPriceSuggestion(
    query: PriceSuggestionQueryDto,
  ): Promise<PriceSuggestion> {
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_PRICE_SUGGESTION, query)
          .pipe(timeout(10000)),
      )) as PriceSuggestion;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get price suggestion",
        "Product Service",
      );
    }
  }

  async getProductRisks(query: ProductRiskQueryDto): Promise<unknown> {
    try {
      return this.exposeProductReferences(
        await firstValueFrom(
          this.productClient
            .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_ADMIN_RISK_LIST, query)
            .pipe(timeout(10000)),
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get product risk queue",
        "Product Service",
      );
    }
  }

  async rescoreProductRisk(productId: string): Promise<ProductRiskSummary> {
    try {
      const summary = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_ADMIN_RISK_RESCORE, productId)
          .pipe(timeout(10000)),
      )) as unknown as ProductRiskSummary;
      return (await this.exposeProductReferences({
        ...summary,
        productId,
      })) as ProductRiskSummary;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `rescore product risk ID: ${productId}`,
        "Product Service",
      );
    }
  }

  async enqueueProductRiskBackfill(
    request: ProductRiskBackfillDto,
  ): Promise<ProductRiskBackfillResult> {
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_ADMIN_RISK_BACKFILL, request)
          .pipe(timeout(10000)),
      )) as ProductRiskBackfillResult;
    } catch (error: unknown) {
      MicroserviceErrorHandler.handleError(
        error,
        "enqueue product risk backfill",
        "Product Service",
      );
    }
  }

  async checkDuplicateImage(
    sellerId: number,
    imageUrl: string,
  ): Promise<ProductDuplicateAdvisory> {
    assertCloudinaryUrlsOwnedBy([imageUrl], sellerId);
    try {
      const advisory = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_DUPLICATE_IMAGE_CHECK, {
            sellerId,
            imageUrl,
          })
          .pipe(timeout(10000)),
      )) as unknown as ProductDuplicateAdvisory;
      return (await this.exposeProductReferences(
        advisory,
      )) as ProductDuplicateAdvisory;
    } catch (error: unknown) {
      MicroserviceErrorHandler.handleError(
        error,
        "check duplicate product image",
        "Product Service",
      );
    }
  }

  async recordProductRiskFeedback(
    productId: string,
    moderatorId: number,
    decision: "confirmed_duplicate" | "dismissed",
    note?: string,
  ): Promise<ProductRiskFeedbackResult> {
    try {
      const feedback = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_ADMIN_RISK_FEEDBACK, {
            productId,
            moderatorId,
            decision,
            note,
          })
          .pipe(timeout(10000)),
      )) as unknown as ProductRiskFeedbackResult;
      return (await this.exposeProductReferences({
        ...feedback,
        productId,
      })) as ProductRiskFeedbackResult;
    } catch (error: unknown) {
      MicroserviceErrorHandler.handleError(
        error,
        "record product risk feedback",
        "Product Service",
      );
    }
  }

  async createProduct(dto: CreateProductDto, userId: number): Promise<unknown> {
    if (dto.imageUrls?.length) {
      assertCloudinaryUrlsOwnedBy(dto.imageUrls, userId);
    }
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
                sku: this.buildInventorySku(result.id, dto.sku),
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

      return await this.exposeProductReferences(this.attachCategoryIds(result));
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
    const resolvedQuery = await this.resolveProductQuery(query);
    const { provinceId: provinceIds, ...productQuery } = resolvedQuery;
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 10);

    // Province filter: resolve seller ids whose DEFAULT address is in the
    // requested provinces, then filter products by those sellers. A resolution
    // failure must throw — silently returning unfiltered rows would be wrong.
    let sellerIdsInProvinces: number[] | undefined;
    if (provinceIds && provinceIds.length > 0) {
      sellerIdsInProvinces = (await firstValueFrom(
        this.userClient
          .send(
            { cmd: USER_MESSAGE_PATTERN.GET_USER_IDS_BY_PROVINCE },
            { provinceIds },
          )
          .pipe(timeout(10000)),
      )) as number[];
      if (!sellerIdsInProvinces || sellerIdsInProvinces.length === 0) {
        return { items: [], total: 0, page, limit };
      }
    }

    const response = (await firstValueFrom(
      this.productClient
        .send(
          PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_ALL,
          sellerIdsInProvinces
            ? { ...productQuery, userIds: sellerIdsInProvinces }
            : productQuery,
        )
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
      return await this.exposeProductReferences(items);
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "fetch products",
        "Product Service",
      );
    }
  }

  async getProductById(id: number | string): Promise<unknown> {
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
      return await this.exposeProductReferences(
        this.attachCategoryIds(enriched),
      );
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
      return await this.exposeProductReferences(this.withCategoryIds(response));
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `fetch product by SKU: ${sku}`,
        "Product Service",
      );
    }
  }

  async updateProduct(
    id: number | string,
    dto: UpdateProductDto,
    callerId: number,
    callerRole: string,
  ): Promise<unknown> {
    await this.assertProductMutationAccess(id, callerId, callerRole);
    // Admins may edit another seller's product, whose images belong to that
    // seller — only enforce media ownership for a non-admin (the owner).
    if (dto.imageUrls?.length && callerRole !== "admin") {
      assertCloudinaryUrlsOwnedBy(dto.imageUrls, callerId);
    }
    try {
      return await this.exposeProductReferences(
        await firstValueFrom(
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
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `update product ID: ${id}`,
        "Product Service",
      );
    }
  }

  async deleteProduct(
    id: number | string,
    callerId: number,
    callerRole: string,
  ): Promise<unknown> {
    const internalProductId = await this.assertProductMutationAccess(
      id,
      callerId,
      callerRole,
    );
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
    await this.cleanupInventoryForProduct(internalProductId);

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

  private buildInventorySku(productId: number | string, sku?: string): string {
    const normalizedSku = sku?.trim();
    return normalizedSku && normalizedSku.length > 0
      ? normalizedSku
      : `PROD-${String(productId)}`;
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

  async getSkusByProduct(productId: string): Promise<unknown> {
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

  private async assertProductMutationAccess(
    productId: number | string,
    callerId: number,
    callerRole: string,
  ): Promise<number> {
    const product = await this.fetchProductForAccess(productId);
    if (callerRole !== "admin" && Number(product.userId) !== callerId) {
      throw new ForbiddenException(PRODUCT_MESSAGE.CANNOT_MODIFY_ANOTHER_USER);
    }
    return Number(product.id);
  }

  private async fetchProductForAccess(
    productId: number | string,
  ): Promise<ProductData> {
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
    const resolvedQuery = await this.resolveProductQuery(query);
    const response = (await firstValueFrom(
      this.productClient
        .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_CATEGORY, {
          categoryId,
          query: resolvedQuery,
        })
        .pipe(timeout(10000)),
    )) as unknown;
    return this.exposeProductReferences(this.withCategoryIds(response));
  }

  async getProductsByBrand(
    brandId: number,
    query: GetProductsQueryDto,
  ): Promise<unknown> {
    const resolvedQuery = await this.resolveProductQuery(query);
    const response = (await firstValueFrom(
      this.productClient
        .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_BRAND, {
          brandId,
          query: resolvedQuery,
        })
        .pipe(timeout(10000)),
    )) as unknown;
    return this.exposeProductReferences(this.withCategoryIds(response));
  }

  async searchProducts(query: GetProductsQueryDto): Promise<unknown> {
    const resolvedQuery = await this.resolveProductQuery(query);
    const response = (await firstValueFrom(
      this.productClient
        .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_SEARCH, resolvedQuery)
        .pipe(timeout(10000)),
    )) as unknown;
    return this.exposeProductReferences(this.withCategoryIds(response));
  }

  // ============================================================================
  // BRAND OPERATIONS
  // ============================================================================

  async createBrand(dto: CreateBrandDto, userId: number): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.BRAND_CREATE, {
            ...dto,
            submittedBy: userId,
          })
          .pipe(timeout(10000)),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create brand",
        "Product Service",
      );
    }
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
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_CREATE, {
            ...dto,
            submittedBy: userId,
          })
          .pipe(timeout(10000)),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create category",
        "Product Service",
      );
    }
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
    productId: string,
  ): Promise<ProductWithInventory | null> {
    try {
      this.logger.debug(`Aggregating data for product ID: ${productId}`);

      const product = await this.fetchProductForAccess(productId);
      const internalProductId = Number(product.id);
      const inventory = await firstValueFrom(
        this.inventoryClient.send<unknown>(
          INVENTORY_MESSAGE_PATTERNS.INVENTORY_FIND_BY_PRODUCT_ID,
          internalProductId,
        ),
      ).catch((err: unknown) => {
        this.logger.warn(
          `Inventory service error for product ID ${productId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });

      // If product doesn't exist, return null
      if (!product) {
        this.logger.debug(`Product not found for ID: ${productId}`);
        return null;
      }

      // Enrich product with user information
      const enrichedProduct = await this.enrichProductWithUserInfo(product);

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
      return (await this.exposeProductReferences(
        result,
      )) as ProductWithInventory;
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
    productIds: string[],
  ): Promise<ProductWithInventory[]> {
    try {
      if (!productIds || productIds.length === 0) {
        return [];
      }

      // Fetch products (one batched call — PERF-02: was N per-id sends) and
      // inventory data in parallel. Inventory is optional context — if the
      // inventory service is unavailable we degrade to `inventory: null`
      // instead of failing the whole request with a raw 500. Missing product
      // ids are skipped by the batch handler (treated as deleted).
      const products = await firstValueFrom(
        this.productClient
          .send<
            ProductData[]
          >(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS, productIds)
          .pipe(timeout(10000)),
      ).catch((err: unknown) => {
        this.logger.warn(
          `Product service error for IDs [${productIds.join(", ")}]: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [] as ProductData[];
      });
      const internalProductIds = products.map((product) => Number(product.id));
      const inventoryItems = await firstValueFrom(
        this.inventoryClient
          .send<
            InventoryData[]
          >(INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_BY_PRODUCT_IDS, internalProductIds)
          .pipe(timeout(10000)),
      ).catch((err: unknown) => {
        this.logger.warn(
          `Inventory service error for product IDs [${productIds.join(", ")}]: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [] as InventoryData[];
      });
      const typedInventoryItems = inventoryItems;

      // Create inventory map for quick lookup
      const inventoryMap = new Map<number, InventoryData>();
      if (typedInventoryItems && Array.isArray(typedInventoryItems)) {
        typedInventoryItems.forEach((item) => {
          if (item.productId !== undefined) {
            // PG bigint serializes productId as a string — normalize the key
            // to number so it matches the Number(product.id) lookup below.
            inventoryMap.set(Number(item.productId), {
              ...item,
              totalStock:
                (item.availableStock ?? 0) + (item.reservedStock ?? 0),
              isLowStock:
                (item.availableStock ?? 0) <= (item.minimumStock ?? 0),
            });
          }
        });
      }

      // Enrich products with user information (single pass — PERF-02: was
      // double-enriched via getProductById + a second whole-list pass), then
      // expose a flat categoryIds[] (P1-04) to match the per-id read shape.
      const validProducts = Array.isArray(products)
        ? products.filter((p) => p !== null)
        : [];
      const enrichedProducts =
        await this.enrichProductsWithUserInfo(validProducts);

      // Combine products with their inventory data
      const results = enrichedProducts.map((product) => ({
        ...(this.attachCategoryIds(
          product as object,
        ) as unknown as ProductWithInventory),
        inventory:
          (inventoryMap.get(
            Number(product.id),
          ) as unknown as ProductWithInventory["inventory"]) ?? null,
      })) as ProductWithInventory[];

      return (await this.exposeProductReferences(
        results,
      )) as ProductWithInventory[];
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

      return PaginatedResponse.of(
        (await this.exposeProductReferences(results)) as ProductWithInventory[],
        total,
        page,
        limit,
      );
    } catch (error) {
      this.logger.error(`Error fetching all products with inventory:`, error);
      throw error;
    }
  }

  async checkProductStock(
    productId: string,
    quantity: number,
  ): Promise<unknown> {
    try {
      const product = await this.fetchProductForAccess(productId);
      return (await firstValueFrom(
        this.inventoryClient.send(
          INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK,
          { productId: Number(product.id), quantity },
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

  async addWishlistItem(productId: string, userId: number): Promise<unknown> {
    try {
      const result = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.WISHLIST_ADD, { productId, userId })
          .pipe(timeout(10000)),
      )) as Record<string, unknown>;
      return { ...result, productId };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `add wishlist product ID: ${productId}`,
        "Product Service",
      );
    }
  }

  async removeWishlistItem(productId: string, userId: number): Promise<void> {
    try {
      await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.WISHLIST_REMOVE, { productId, userId })
          .pipe(timeout(10000)),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `remove wishlist product ID: ${productId}`,
        "Product Service",
      );
    }
  }

  async getWishlist(userId: number, query: WishlistQueryDto): Promise<unknown> {
    try {
      const response = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.WISHLIST_LIST, {
            userId,
            page: query.page ?? 1,
            limit: query.limit ?? 20,
          })
          .pipe(timeout(10000)),
      )) as unknown;
      const withCategoryIds = this.withCategoryIds(response);

      if (
        withCategoryIds &&
        typeof withCategoryIds === "object" &&
        Array.isArray((withCategoryIds as { data?: unknown }).data)
      ) {
        const envelope = withCategoryIds as { data: ProductData[] };
        return {
          ...withCategoryIds,
          data: await this.enrichProductsWithUserInfo(envelope.data),
        };
      }

      return this.exposeProductReferences(withCategoryIds);
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `get wishlist for user ID: ${userId}`,
        "Product Service",
      );
    }
  }

  // ============================================================================
  // REVIEW OPERATIONS
  // ============================================================================

  async createProductReview(
    productId: string,
    userId: number,
    dto: CreateReviewDto,
  ): Promise<unknown> {
    try {
      const product = await this.fetchProductForAccess(productId);
      const internalProductId = Number(product.id);
      await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.VERIFY_PRODUCT_PURCHASED, {
            userId,
            productId: internalProductId,
          })
          .pipe(timeout(10000)),
      );
      const review = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.REVIEW_CREATE, {
            userId,
            productId,
            rating: dto.rating,
            comment: dto.comment,
          })
          .pipe(timeout(10000)),
      )) as Record<string, unknown>;
      return { ...review, productId };
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
    productId: string,
    page: number,
    limit: number,
  ): Promise<unknown> {
    try {
      const reviews = await firstValueFrom(
        this.productClient
          .send<unknown>(PRODUCT_MESSAGE_PATTERNS.REVIEW_FIND_BY_PRODUCT, {
            productId,
            page,
            limit,
          })
          .pipe(timeout(10000)),
      );
      return this.exposeProductReferences(reviews);
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
      this.logger.debug(
        `Single user response for userId ${userId}: ${user ? "found" : "not found"}`,
      );

      return {
        ...product,
        // PUBID-02: seller embeds expose the opaque public id, never the PK.
        user: user
          ? {
              id: user.publicId ?? String(user.id),
              name: user.username,
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

      // Fetch all unique users in one batched TCP call (PERF-01: was N per-user sends)
      this.logger.debug(
        `Fetching user info for userIds: ${JSON.stringify(userIds)}`,
      );
      const users = (await firstValueFrom(
        this.userClient
          .send(
            { cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS },
            { userIds, includeProvince: true },
          )
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              this.logger.warn(
                `Failed to fetch users by ids: ${JSON.stringify(userIds)}`,
                err instanceof Error ? err.message : String(err),
              );
              return of([] as UserData[]);
            }),
          ),
      )) as UserData[];

      // Create user map for quick lookup
      // Map keys stay the internal numeric id (matches product.userId); the
      // stored `id` is the exposed opaque public id (PUBID-02).
      const userMap = new Map<number, UserData>();
      users.forEach((user) => {
        if (user && typeof user.id === "number") {
          userMap.set(user.id, {
            id: user.publicId ?? String(user.id),
            name: user.name,
            avatar: user.avatar,
            province: user.province ?? null,
          });
        }
      });

      // Enrich products with user information; sellerProvince is exposed at
      // row level (from the seller's default GHN address) for the FE filter
      return products.map((product) => {
        const user = product.userId
          ? (userMap.get(parseInt(String(product.userId))) ?? null)
          : null;
        return {
          ...product,
          user: user
            ? { id: user.id, name: user.name, avatar: user.avatar }
            : null,
          sellerProvince: user?.province ?? null,
        };
      });
    } catch (error) {
      this.logger.error("Error enriching products with user info:", error);
      // Return original products if enrichment fails
      return products;
    }
  }
}
