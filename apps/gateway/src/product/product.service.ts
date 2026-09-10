import { ForbiddenException, Injectable, Inject, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout, catchError } from "rxjs";
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
import { retryOnTransportError } from "../common/exception/transport-error";
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
import { CachedService } from "@app/cached";
import {
  InventoryData,
  ProductData,
  ProductWithInventory,
  StockSyncTarget,
  UserData,
  PriceSuggestion,
  ProductRiskSummary,
  ProductRiskBackfillResult,
  ProductDuplicateAdvisory,
  ProductRiskFeedbackResult,
} from "./product.types";
import { TCP_TIMEOUT_MS } from "libs/constant/tcp-timeout.constant";

/** Fields of a nested `brand` / `categories[]` row that survive to HTTP. */
const TAXONOMY_SUMMARY_KEYS = ["id", "name", "isActive"] as const;

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
    private readonly cached: CachedService,
  ) {}

  // SCALE-04: full-response micro-cache for the hot @Public product reads.
  // Both cached routes are user-invariant (no req.user in the response), so
  // one Redis GET replaces the product TCP + user-enrichment TCP round trips.
  private static readonly PUBLIC_READ_CACHE_TTL_SECONDS = 10;
  private static readonly LIST_CACHE_PREFIX = "gw:products:list:";
  private static readonly DETAIL_CACHE_PREFIX = "gw:products:detail:";

  private buildListCacheKey(query: GetProductsQueryDto): string {
    const sortedQueryEntries = Object.entries(
      query as unknown as Record<string, unknown>,
    )
      .filter(([, queryValue]) => queryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
    return `${ProductService.LIST_CACHE_PREFIX}${JSON.stringify(sortedQueryEntries)}`;
  }

  private async readPublicCache(cacheKey: string): Promise<unknown> {
    try {
      const cachedPayload = await this.cached.get(cacheKey);
      return cachedPayload === null
        ? null
        : (JSON.parse(cachedPayload) as unknown);
    } catch (error) {
      this.logger.warn(
        `Public read cache get failed for ${cacheKey}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async writePublicCache(
    cacheKey: string,
    payload: unknown,
  ): Promise<void> {
    try {
      await this.cached.set(
        cacheKey,
        JSON.stringify(payload),
        ProductService.PUBLIC_READ_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Public read cache set failed for ${cacheKey}: ${(error as Error).message}`,
      );
    }
  }

  private async invalidatePublicProductCache(
    productId: number | string,
  ): Promise<void> {
    try {
      const listKeys = await this.cached.keys(
        `${ProductService.LIST_CACHE_PREFIX}*`,
      );
      await Promise.all([
        this.cached.del(`${ProductService.DETAIL_CACHE_PREFIX}${productId}`),
        ...listKeys.map((listKey) => this.cached.del(listKey)),
      ]);
    } catch (error) {
      this.logger.warn(
        `Public read cache invalidation failed for product ${productId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * OVERFETCH-01 (3): `brand` and `categories` are eager relations, so every
   * product row carried the FULL taxonomy entity — `description`, `status`,
   * `submittedBy`, `reviewNote`, `createdAt`, `updatedAt` — repeated once per
   * product per category. Only the display fields belong on a product row; the
   * moderation columns are the moderation queue's business and those routes
   * (`getPendingBrands` / `getPendingCategories` / `getAllBrands` /
   * `getAllCategories`) do not pass through this walker, so they keep them.
   */
  private trimTaxonomyReferences(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.trimTaxonomyReferences(item));
    }
    if (!value || typeof value !== "object") {
      return value;
    }
    const trimmed: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      trimmed[key] =
        key === "brand" || key === "categories"
          ? this.pickTaxonomySummary(nestedValue)
          : this.trimTaxonomyReferences(nestedValue);
    }
    return trimmed;
  }

  /** Reduces a brand/category row to the fields a product card renders. */
  private pickTaxonomySummary(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.pickTaxonomySummary(item));
    }
    if (!value || typeof value !== "object") {
      return value;
    }
    const raw = value as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    for (const key of TAXONOMY_SUMMARY_KEYS) {
      if (key in raw) {
        summary[key] = raw[key];
      }
    }
    return summary;
  }

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
      // Risk-feedback rows carry the admin who judged the duplicate as
      // `moderatorId`; it was the one moderation id still leaving raw
      // (PRODTEST-0806 #4).
      "moderatorId",
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
        .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
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

  /**
   * Brand/category rows carry `submittedBy` — the numeric PK of the seller who
   * proposed them. Only the moderation queue has a reason to show it, and there
   * it is resolved to a `usr_` public id. Everywhere else the field is unread
   * weight that leaks an internal id, so it is dropped instead of resolved:
   * these are hot, cached catalog reads and must not start depending on the
   * user service being up (PRODTEST-0806 #4).
   */
  private hideSubmittedBy(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.hideSubmittedBy(item));
    }
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "submittedBy")
        .map(([key, nested]) => [key, this.hideSubmittedBy(nested)]),
    );
  }

  /**
   * Moderation-queue variant: resolve `submittedBy` to a `usr_` public id, but
   * never let a user-service outage take the queue down — a moderator can still
   * approve/reject without knowing who submitted, so an unresolvable batch
   * degrades to the field being dropped rather than to a 500.
   */
  private async exposeSubmittedBy(value: unknown): Promise<unknown> {
    try {
      return await this.exposeUserReferences(value);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not resolve submittedBy — ${message}`);
      return this.hideSubmittedBy(value);
    }
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
      return this.exposeUserReferences(
        this.trimTaxonomyReferences(this.exposeProductPayload(value)),
      );
    }
    const products = await firstValueFrom(
      this.productClient
        .send<
          ProductData[]
        >(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS, [...productIds])
        .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
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
    return this.exposeUserReferences(
      this.trimTaxonomyReferences(expose(value)),
    );
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
        .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
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
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
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
            .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
          .pipe(timeout(TCP_TIMEOUT_MS.READ)),
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
            timeout(TCP_TIMEOUT_MS.WRITE),
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
              .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
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
          timeout(TCP_TIMEOUT_MS.READ),
          retryOnTransportError(),
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

  /**
   * PRODTEST-0806: this route used to return a BARE array while every sibling
   * catalog list (`/products/category/:id`, `/products/brand/:id`, search)
   * returned the standard envelope. It now returns `PaginatedResponse` too, so
   * the FE reads `data`/`total`/`totalPages`/`hasNext` uniformly.
   */
  async getAllProducts(
    query: GetProductsQueryDto,
  ): Promise<PaginatedResponse<ProductData>> {
    try {
      const cacheKey = this.buildListCacheKey(query);
      const cachedResponse = await this.readPublicCache(cacheKey);
      if (cachedResponse !== null) {
        return cachedResponse as PaginatedResponse<ProductData>;
      }

      this.logger.log(
        `Fetching all products with query: ${JSON.stringify(query)}`,
      );

      const { items, total, page, limit } = await this.fetchProductsPage(query);

      this.logger.log(`Found ${items.length} products with user info`);
      const paginatedProducts = PaginatedResponse.of(
        (await this.exposeProductReferences(items)) as ProductData[],
        total,
        page,
        limit,
      );
      await this.writePublicCache(cacheKey, paginatedProducts);
      return paginatedProducts;
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
      const cacheKey = `${ProductService.DETAIL_CACHE_PREFIX}${id}`;
      const cachedResponse = await this.readPublicCache(cacheKey);
      if (cachedResponse !== null) {
        return cachedResponse;
      }

      this.logger.log(`Fetching product by ID: ${id}`);
      const response = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID, id)
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
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
      const exposedProduct = await this.exposeProductReferences(
        this.attachCategoryIds(enriched),
      );
      if (product) {
        await this.writePublicCache(cacheKey, exposedProduct);
      }
      return exposedProduct;
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
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
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
    const existingProduct = await this.assertProductMutationAccess(
      id,
      callerId,
      callerRole,
    );
    const internalProductId = Number(existingProduct.id);
    // Admins may edit another seller's product, whose images belong to that
    // seller — only enforce media ownership for a non-admin (the owner).
    if (dto.imageUrls?.length && callerRole !== "admin") {
      assertCloudinaryUrlsOwnedBy(dto.imageUrls, callerId);
    }
    try {
      // Inventory lives in another database, so its write can never join the
      // product transaction — this PATCH is two writes, not one. Resolving the
      // target row BEFORE touching the product keeps the common failures
      // (inventory down, unreachable, no base row) from leaving product fields
      // committed behind an error response; only the inventory write itself can
      // still fail late, and the mirror restore below covers that leg.
      const stockSyncTarget =
        dto.stockQuantity === undefined
          ? null
          : await this.resolveStockSyncTarget(
              internalProductId,
              dto.stockQuantity,
            );

      const updatedProduct = await this.exposeProductReferences(
        await firstValueFrom(
          this.productClient
            .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_UPDATE, {
              id,
              updateProductDto: dto,
            })
            .pipe(
              timeout(TCP_TIMEOUT_MS.WRITE),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        ),
      );
      // Inventory owns stock — products.stock_quantity is only a mirror the
      // inventory.stock_changed fanout refreshes. Push the edited value across
      // so it is not silently reverted by the next stock event.
      if (stockSyncTarget) {
        try {
          await this.applyStockSync(stockSyncTarget);
        } catch (invErr) {
          // Inventory refused or is unreachable. The product row already holds
          // the new number, so leaving it there would make the catalog claim
          // stock inventory never accepted — the exact desync this sync exists
          // to prevent. Put the mirror back before surfacing the failure.
          await this.restoreProductStockMirror(
            id,
            existingProduct.stockQuantity,
          );
          throw invErr;
        }
      }
      await this.invalidatePublicProductCache(id);
      return updatedProduct;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `update product ID: ${id}`,
        "Product Service",
      );
    }
  }

  /**
   * Read half of the stock mirror: find the base inventory row a seller-supplied
   * `stockQuantity` has to be pushed into. Runs BEFORE the product write so an
   * unreachable inventory service aborts the PATCH with nothing committed.
   *
   * Returns null when there is nothing to push: SKU-matrix products keep one
   * inventory row per SKU and own no base row (their stock is edited per SKU),
   * and a value already in sync needs no write. Any transport/service error
   * still propagates, so the seller learns the new stock did not apply instead
   * of losing it silently.
   */
  private async resolveStockSyncTarget(
    productId: number,
    availableStock: number,
  ): Promise<StockSyncTarget | null> {
    const inventoryRows = await firstValueFrom(
      this.inventoryClient
        .send<
          InventoryData[]
        >(INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_BY_PRODUCT_IDS, [productId])
        .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
    );

    const baseRow = Array.isArray(inventoryRows)
      ? inventoryRows.find((row) => row.productSkuId == null)
      : undefined;

    if (baseRow?.id == null) {
      this.logger.warn(
        `No base inventory row for product ${productId} — stock quantity not propagated`,
      );
      return null;
    }

    if (baseRow.availableStock === availableStock) {
      return null;
    }

    return { productId, inventoryId: Number(baseRow.id), availableStock };
  }

  /**
   * Write half of the stock mirror. Without this push the edited number lived in
   * MySQL only until the next `inventory.stock_changed` event overwrote it from
   * Postgres, so a stock edit disappeared with no error (the PATCH still
   * answered 200).
   */
  private async applyStockSync(target: StockSyncTarget): Promise<void> {
    await firstValueFrom(
      this.inventoryClient
        .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_UPDATE, {
          id: target.inventoryId,
          update: { availableStock: target.availableStock },
        })
        .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
    );
    this.logger.log(
      `Inventory available stock for product ${target.productId} set to ${target.availableStock}`,
    );
  }

  /**
   * Best-effort rollback of the product-side stock mirror after inventory
   * rejected the edit. Best-effort on purpose: the caller is already about to
   * report the inventory failure, and a failed rollback must not replace that
   * message with a second, less useful one.
   */
  private async restoreProductStockMirror(
    id: number | string,
    previousStockQuantity: unknown,
  ): Promise<void> {
    if (typeof previousStockQuantity !== "number") {
      return;
    }
    try {
      await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_UPDATE, {
            id,
            updateProductDto: { stockQuantity: previousStockQuantity },
          })
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
      );
    } catch (err) {
      this.logger.error(
        `Could not restore stock mirror for product ${String(id)} to ${previousStockQuantity}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async deleteProduct(
    id: number | string,
    callerId: number,
    callerRole: string,
  ): Promise<unknown> {
    const internalProductId = Number(
      (await this.assertProductMutationAccess(id, callerId, callerRole)).id,
    );
    let result: unknown;
    try {
      result = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_DELETE, id)
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
    await this.invalidatePublicProductCache(id);

    return result;
  }

  private async compensateProductCreate(productId: number): Promise<void> {
    try {
      await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_DELETE, productId)
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
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

  /**
   * Ownership gate for product mutations. Returns the product it already had to
   * read, so a caller needing its pre-edit state (internal id, current stock)
   * does not pay for a second round trip.
   */
  private async assertProductMutationAccess(
    productId: number | string,
    callerId: number,
    callerRole: string,
  ): Promise<ProductData> {
    const product = await this.fetchProductForAccess(productId);
    if (callerRole !== "admin" && Number(product.userId) !== callerId) {
      throw new ForbiddenException(PRODUCT_MESSAGE.CANNOT_MODIFY_ANOTHER_USER);
    }
    return product;
  }

  private async fetchProductForAccess(
    productId: number | string,
  ): Promise<ProductData> {
    try {
      return (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID, productId)
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
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
        .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
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
        .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
    )) as unknown;
    return this.exposeProductReferences(this.withCategoryIds(response));
  }

  async searchProducts(query: GetProductsQueryDto): Promise<unknown> {
    const resolvedQuery = await this.resolveProductQuery(query);
    const response = (await firstValueFrom(
      this.productClient
        .send(PRODUCT_MESSAGE_PATTERNS.PRODUCT_SEARCH, resolvedQuery)
        .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
    )) as unknown;
    return this.exposeProductReferences(this.withCategoryIds(response));
  }

  // ============================================================================
  // BRAND OPERATIONS
  // ============================================================================

  async createBrand(dto: CreateBrandDto, userId: number): Promise<unknown> {
    try {
      return this.hideSubmittedBy(
        await firstValueFrom(
          this.productClient
            .send(PRODUCT_MESSAGE_PATTERNS.BRAND_CREATE, {
              ...dto,
              submittedBy: userId,
            })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create brand",
        "Product Service",
      );
    }
  }

  async getAllBrands(): Promise<unknown> {
    return this.hideSubmittedBy(
      await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.BRAND_FIND_ALL, {})
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
      ),
    );
  }

  async getPendingBrands(): Promise<unknown> {
    // The moderation queue is the one place `submittedBy` is actually rendered,
    // so it is resolved to a `usr_` public id rather than dropped.
    return this.exposeSubmittedBy(
      await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.BRAND_FIND_ALL, { status: "pending" })
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
      ),
    );
  }

  async reviewBrand(id: number, dto: ReviewBrandDto): Promise<unknown> {
    try {
      return this.hideSubmittedBy(
        await firstValueFrom(
          this.productClient
            .send(PRODUCT_MESSAGE_PATTERNS.BRAND_REVIEW, {
              id,
              action: dto.action,
              note: dto.note,
            })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `review brand ID: ${id}`,
        "Product Service",
      );
    }
  }

  async getBrandById(id: number): Promise<unknown> {
    return this.hideSubmittedBy(
      await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.BRAND_FIND_BY_ID, id)
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
      ),
    );
  }

  // ============================================================================
  // CATEGORY OPERATIONS
  // ============================================================================

  async createCategory(
    dto: CreateCategoryDto,
    userId: number,
  ): Promise<unknown> {
    try {
      return this.hideSubmittedBy(
        await firstValueFrom(
          this.productClient
            .send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_CREATE, {
              ...dto,
              submittedBy: userId,
            })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
        ),
      );
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
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
      )) as unknown as unknown[];
      this.logger.log(`Found ${result?.length ?? 0} categories`);
      return this.hideSubmittedBy(result);
    } catch (error) {
      this.logger.error("Failed to fetch categories:", error);
      throw error;
    }
  }

  async getPendingCategories(): Promise<unknown> {
    // Same as the pending brands queue — `submittedBy` is rendered here, so it
    // is resolved to a `usr_` public id instead of dropped.
    return this.exposeSubmittedBy(
      await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_FIND_ALL, {
            status: "pending",
          })
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
      ),
    );
  }

  async reviewCategory(id: number, dto: ReviewCategoryDto): Promise<unknown> {
    try {
      return this.hideSubmittedBy(
        await firstValueFrom(
          this.productClient
            .send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_REVIEW, {
              id,
              action: dto.action,
              note: dto.note,
            })
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        `review category ID: ${id}`,
        "Product Service",
      );
    }
  }

  async getCategoryById(id: number): Promise<unknown> {
    return this.hideSubmittedBy(
      await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.CATEGORY_FIND_BY_ID, id)
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
      ),
    );
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
        this.inventoryClient
          .send<unknown>(
            INVENTORY_MESSAGE_PATTERNS.INVENTORY_FIND_BY_PRODUCT_ID,
            internalProductId,
          )
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
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

  private enrichInventoryData(inventory: InventoryData): InventoryData & {
    totalStock: number;
    isLowStock: boolean;
    stockStatus: string;
    lastUpdated: InventoryData["updatedAt"];
  } {
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
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
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
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
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

      // Fetch products (one batched call — PERF-02: was N per-id sends), then
      // inventory for whatever resolved.
      //
      // The two legs fail DIFFERENTLY on purpose (BATCH-FAIL-01). A product id
      // that no longer resolves is skipped by the batch handler and the caller
      // reads absence as "deleted" (SHAPE-01 rule 4) — but that only holds when
      // the response really is the catalog's answer. Swallowing a product
      // service outage into `[]` says "all of these are deleted", which is a
      // lie the client cannot detect: a cart or wishlist rendered from this
      // endpoint would silently show up empty and the user would re-add items
      // that were never gone. An outage must surface as an error status, so the
      // failure propagates through MicroserviceErrorHandler.
      //
      // Inventory is different: it is optional context hanging off a product
      // that DID resolve, so an inventory outage degrades to `inventory: null`
      // (SHAPE-01 rule 1 — a missing single relation stays null) rather than
      // failing a read the catalog can already answer.
      const products = await firstValueFrom(
        this.productClient
          .send<
            ProductData[]
          >(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS, productIds)
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
      ).catch((err: unknown) =>
        MicroserviceErrorHandler.handleError(
          err,
          `fetch products by IDs [${productIds.join(", ")}]`,
          "Product Service",
          // Never let the keyword matcher guess a status here. A product-service
          // error whose text happens to contain "not found" (a DB failure, say)
          // would become a 404, which the FE reads as "the batch is gone" — it
          // then retries per id, every sub-call fails the same way, and the
          // caller is handed the empty list this whole branch exists to prevent.
          // A declared business status still passes through untouched.
          { guessStatusFromMessage: false },
        ),
      );
      // Normalize once, before anything indexes into the list: the guard used
      // to sit further down (`validProducts`) while `products.map` above it
      // already assumed an array, so a malformed batch response threw a
      // TypeError into the outer catch and came back as a raw 500.
      const resolvedProducts = Array.isArray(products)
        ? products.filter((product) => product !== null)
        : [];
      if (resolvedProducts.length === 0) {
        // Every requested id is gone from the catalog — a legitimate empty
        // answer now that the product service really was reached. No point
        // asking inventory about an empty id list.
        return [];
      }

      const internalProductIds = resolvedProducts.map((product) =>
        Number(product.id),
      );
      const inventoryItems = await firstValueFrom(
        this.inventoryClient
          .send<
            InventoryData[]
          >(INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_BY_PRODUCT_IDS, internalProductIds)
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
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
      const enrichedProducts =
        await this.enrichProductsWithUserInfo(resolvedProducts);

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
        this.inventoryClient
          .send(
            INVENTORY_MESSAGE_PATTERNS.INVENTORY_GET_BY_PRODUCT_IDS,
            productIds,
          )
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
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
      const stock = (await firstValueFrom(
        this.inventoryClient
          .send(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK, {
            productId: Number(product.id),
            quantity,
          })
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
      )) as Record<string, unknown>;
      // Inventory echoes back the internal numeric productId it was queried
      // with; hand the caller back the opaque id it asked about instead
      // (PRODTEST-0806 #4).
      return { ...stock, productId };
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
      )) as unknown;
      const withCategoryIds = this.withCategoryIds(response);

      if (
        withCategoryIds &&
        typeof withCategoryIds === "object" &&
        Array.isArray((withCategoryIds as { data?: unknown }).data)
      ) {
        const envelope = withCategoryIds as { data: ProductData[] };
        // WISHLIST-ID-01: the enriched envelope must still go through
        // exposeProductReferences — it is what swaps `id` for the `prod_` public
        // id, drops `publicId`, and maps `userId` to `usr_`. Returning the
        // enriched rows directly leaked numeric ids here while every sibling
        // catalog list exposed them, so wishlist links pointed at `/product/29`.
        return await this.exposeProductReferences({
          ...envelope,
          data: await this.enrichProductsWithUserInfo(envelope.data),
        });
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
      );
      const review = (await firstValueFrom(
        this.productClient
          .send(PRODUCT_MESSAGE_PATTERNS.REVIEW_CREATE, {
            userId,
            productId,
            rating: dto.rating,
            comment: dto.comment,
          })
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
      )) as Record<string, unknown>;
      // REVIEW-ID-01: same exposure as the GET on this resource, so the created
      // row reports `userId: "usr_..."` rather than the internal numeric id.
      // `productId` is already the opaque id here and is left untouched.
      return await this.exposeProductReferences({ ...review, productId });
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
          .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
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

  /**
   * ENRICH-FAIL-01 — a seller that does not resolve is `user: null` (the
   * user-service handler returns null for a deleted/unknown id, it does not
   * throw), but a user-service FAILURE is no longer downgraded to that same
   * `null`. The two are indistinguishable to the client, and the FE fills the
   * blank with a fabricated shop name.
   *
   * Throwing here costs nothing that was not already lost: every caller runs
   * `exposeProductReferences` → `exposeUserReferences` on the same response,
   * which hits the SAME user service with no catch, so a real outage already
   * answered 502 — the swallow only made the flaky case (one leg times out,
   * the other does not) answer 200 with a silently missing seller.
   */
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
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
      this.logger.warn(
        `User enrichment failed for product ${String(product.id ?? "")}, userId: ${String(product.userId ?? "")}`,
        error instanceof Error ? error.message : String(error),
      );
      MicroserviceErrorHandler.handleError(
        error,
        `fetch seller info for product ID: ${String(product.id ?? "")}`,
        "User Service",
      );
    }
  }

  /**
   * ENRICH-FAIL-01 — same rule as the single-product variant, and the case that
   * mattered most: this one leg failing used to blank the seller on the WHOLE
   * list at once, which is never "each of these sellers happens to be deleted".
   * See `enrichProductWithUserInfo` for why throwing does not cost availability.
   */
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
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
      MicroserviceErrorHandler.handleError(
        error,
        `fetch seller info for ${products.length} product(s)`,
        "User Service",
      );
    }
  }
}
