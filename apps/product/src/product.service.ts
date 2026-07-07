import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository, SelectQueryBuilder } from "typeorm";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout } from "rxjs";
import { Channel } from "amqplib";
import { PaginatedResponse } from "@app/common";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";
import { CachedService } from "@app/cached";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { ORDER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { Product } from "./entity/product.entity";
import { ProductReview } from "./entity/product-review.entity";
import { ProductSku } from "./entity/product-sku.entity";
import { WishlistItem } from "./entity/wishlist-item.entity";
import { Brand } from "./entity/brand.entity";
import { Category } from "./entity/category.entity";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { CreateBrandDto } from "./dto/create-brand.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { GetProductsQueryDto } from "./dto/get-products-query.dto";
import { CreateProductSkuDto } from "./dto/create-product-sku.dto";

const SEARCH_CACHE_TTL = 5; // seconds

type WishlistMutationResult = {
  productId: number;
  isWishlisted: boolean;
  createdAt: Date;
};

type WishlistedProduct = Product & {
  wishlistedAt: Date;
};

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(ProductReview)
    private readonly reviewRepository: Repository<ProductReview>,
    @InjectRepository(ProductSku)
    private readonly skuRepository: Repository<ProductSku>,
    @InjectRepository(WishlistItem)
    private readonly wishlistRepository: Repository<WishlistItem>,
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel | null,
    @Inject(NAME_SERVICE_TCP.ORDERS_SERVICE)
    private readonly ordersClient: ClientProxy,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ordersClient.connect();
  }

  private buildSearchCacheKey(query: GetProductsQueryDto): string {
    const stable = JSON.stringify(
      Object.fromEntries(
        Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
    return `products:search:${stable}`;
  }

  private async invalidateSearchCache(): Promise<void> {
    try {
      const keys = await this.cachedService.keys("products:search:*");
      if (keys.length > 0) {
        await Promise.all(keys.map((k) => this.cachedService.del(k)));
      }
    } catch (err) {
      this.logger.warn(
        "Failed to invalidate product search cache",
        String(err),
      );
    }
  }

  async updateStockQuantity(
    productId: number,
    availableStock: number,
  ): Promise<void> {
    const result = await this.productRepository.update(
      { id: productId },
      { stockQuantity: availableStock },
    );
    if (result.affected === 0) {
      this.logger.warn(
        `[PRODUCT] Product ${productId} not found for stock update`,
      );
      throw new NotFoundException(`Product ${productId} not found`);
    }
    this.logger.log(
      `[PRODUCT] Updated stockQuantity for product ${productId} to ${availableStock}`,
    );
  }

  /**
   * Validate that every SKU's tierIdx is structurally consistent with the
   * product's variation axes: one index per variation, each index within the
   * bounds of that variation's options. Rejects malformed combinations (e.g.
   * a SKU carrying 2 tier indices for a product that has a single variation)
   * before they reach the database.
   */
  private validateSkuTiers(
    variations: { name: string; options: string[] }[] | null,
    skuList: CreateProductSkuDto[],
  ): void {
    const axes = Array.isArray(variations) ? variations : [];
    const variationCount = axes.length;

    for (const dto of skuList) {
      let tierIdx: number[];
      try {
        tierIdx = JSON.parse(dto.tierIdx) as number[];
      } catch {
        throw new BadRequestException(
          `Invalid tierIdx "${dto.tierIdx}" — must be a JSON array string`,
        );
      }

      if (!Array.isArray(tierIdx)) {
        throw new BadRequestException(
          `Invalid tierIdx "${dto.tierIdx}" — must be a JSON array`,
        );
      }

      if (tierIdx.length !== variationCount) {
        throw new BadRequestException(
          `SKU tierIdx ${dto.tierIdx} has ${tierIdx.length} tier(s) but the product defines ${variationCount} variation(s); counts must match`,
        );
      }

      tierIdx.forEach((idx, axis) => {
        const optionCount = axes[axis]?.options?.length ?? 0;
        if (!Number.isInteger(idx) || idx < 0 || idx >= optionCount) {
          throw new BadRequestException(
            `SKU tierIdx ${dto.tierIdx} index ${idx} is out of range for variation "${axes[axis]?.name ?? axis}" (${optionCount} option(s))`,
          );
        }
      });
    }
  }

  // SKU methods

  /**
   * Canonical key for a SKU variation combination, used to diff incoming SKUs
   * against existing rows. Accepts either the raw VARCHAR string (e.g. "[0,1]")
   * or the parsed number[] produced by @AfterLoad — both normalize to the same
   * spaceless JSON string so they compare reliably.
   */
  private canonicalTierKey(tierIdx: string | number[]): string {
    const parsed = Array.isArray(tierIdx)
      ? tierIdx
      : (JSON.parse(tierIdx) as number[]);
    return JSON.stringify(parsed);
  }

  /**
   * Ask the orders service which of the given SKU ids are referenced by an
   * existing order item or cart item. Failures are treated as "all referenced"
   * (fail-safe) so a transient orders outage never causes silent data loss.
   */
  private async getReferencedSkuIds(skuIds: number[]): Promise<number[]> {
    if (skuIds.length === 0) {
      return [];
    }
    try {
      return await firstValueFrom(
        this.ordersClient
          .send<number[]>(ORDER_MESSAGE_PATTERN.GET_REFERENCED_SKU_IDS, {
            skuIds,
          })
          .pipe(timeout(10000)),
      );
    } catch (err) {
      this.logger.warn(
        `[PRODUCT] SKU reference check failed; treating all candidates as referenced: ${String(err)}`,
      );
      return [...skuIds];
    }
  }

  /**
   * Apply a SKU list to a product as a create/update/delete diff keyed on the
   * variation combination (tierIdx). Matched SKUs are updated in place so their
   * id is preserved for any order/cart that references them. Removed SKUs that
   * are still referenced are soft-deactivated (isActive=false) instead of being
   * deleted; unreferenced removed SKUs are hard-deleted (P0-05).
   */
  async upsertSkus(
    productId: number,
    skuList: CreateProductSkuDto[],
  ): Promise<ProductSku[]> {
    // 1. Validate the product exists and the incoming tiers are coherent.
    const product = await this.productRepository.findOne({
      where: { id: productId },
      select: ["id", "variations"],
    });
    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    this.validateSkuTiers(product.variations, skuList);

    // 2. Load existing SKUs and index them by their variation combination.
    const existing = await this.skuRepository.find({ where: { productId } });
    const existingByKey = new Map<string, ProductSku>();
    for (const sku of existing) {
      existingByKey.set(this.canonicalTierKey(sku.tierIdx), sku);
    }
    const incomingKeys = new Set(
      skuList.map((dto) => this.canonicalTierKey(dto.tierIdx)),
    );

    // 3. Removed candidates = existing SKUs absent from the incoming list.
    const removedCandidates = existing.filter(
      (sku) => !incomingKeys.has(this.canonicalTierKey(sku.tierIdx)),
    );

    // 4. Reference check runs OUTSIDE the transaction to avoid holding a DB
    //    lock across a TCP round-trip to the orders service.
    const referencedIds = new Set(
      await this.getReferencedSkuIds(removedCandidates.map((s) => s.id)),
    );

    const deactivatedSkuIds: number[] = [];
    const deletedSkuIds: number[] = [];

    // 5. Apply the diff atomically.
    const saved = await this.dataSource.transaction(async (manager) => {
      const toPersist: ProductSku[] = [];

      for (const dto of skuList) {
        const match = existingByKey.get(this.canonicalTierKey(dto.tierIdx));
        if (match) {
          // Update in place — keep id (and tierIdx) so references survive.
          match.price = dto.price;
          match.stockQuantity = dto.stockQuantity ?? match.stockQuantity;
          match.sku = dto.sku ?? null;
          match.isActive = dto.isActive ?? true;
          match.tierIdx = Array.isArray(match.tierIdx)
            ? JSON.stringify(match.tierIdx)
            : match.tierIdx;
          toPersist.push(match);
        } else {
          toPersist.push(
            manager.create(ProductSku, {
              productId,
              tierIdx: dto.tierIdx,
              price: dto.price,
              stockQuantity: dto.stockQuantity ?? 0,
              sku: dto.sku ?? null,
              isActive: dto.isActive ?? true,
            }),
          );
        }
      }

      for (const candidate of removedCandidates) {
        if (referencedIds.has(candidate.id)) {
          // Referenced by an order/cart — soft-deactivate, never delete.
          candidate.isActive = false;
          candidate.tierIdx = Array.isArray(candidate.tierIdx)
            ? JSON.stringify(candidate.tierIdx)
            : candidate.tierIdx;
          toPersist.push(candidate);
          deactivatedSkuIds.push(candidate.id);
        } else {
          deletedSkuIds.push(candidate.id);
        }
      }

      if (deletedSkuIds.length > 0) {
        await manager.delete(ProductSku, { id: In(deletedSkuIds) });
      }

      const result = await manager.save(ProductSku, toPersist);
      for (const sku of result) {
        if (typeof sku.tierIdx === "string") {
          sku.tierIdx = JSON.parse(sku.tierIdx) as number[];
        }
      }
      return result;
    });

    if (deactivatedSkuIds.length > 0) {
      this.logger.log(
        `[PRODUCT] Product ${productId}: soft-deactivated referenced SKUs [${deactivatedSkuIds.join(", ")}] instead of deleting`,
      );
    }

    if (!this.fanoutChannel) {
      this.logger.warn(
        "[PRODUCT] fanoutChannel unavailable — sku_upserted event skipped",
      );
    } else {
      try {
        this.fanoutChannel.publish(
          EXCHANGE.PRODUCT_EXCHANGE,
          "",
          Buffer.from(
            JSON.stringify({
              pattern: EVENT.SKU_UPSERTED_EVENT,
              data: {
                productId,
                skus: saved.map((s) => ({
                  skuId: s.id,
                  sku: s.sku,
                  stockQuantity: s.stockQuantity,
                })),
                deletedSkuIds,
              },
            }),
          ),
        );
      } catch (err) {
        this.logger.warn(
          `[PRODUCT] Failed to emit sku_upserted event: ${String(err)}`,
        );
      }
    }

    return saved;
  }

  async findSkusByProduct(productId: number): Promise<ProductSku[]> {
    return this.skuRepository.find({
      where: { productId },
      order: { tierIdx: "ASC" },
    });
  }

  async findSkuById(id: number): Promise<ProductSku> {
    const sku = await this.skuRepository.findOne({ where: { id } });
    if (!sku) {
      throw new NotFoundException(`SKU ${id} not found`);
    }
    return sku;
  }

  // Product methods
  async createProduct(createProductDto: CreateProductDto): Promise<Product> {
    const { skuList, categoryIds, ...rest } = createProductDto;

    // Only check SKU uniqueness for simple (non-variation) products
    if (rest.sku) {
      const existingProduct = await this.productRepository.findOne({
        where: { sku: rest.sku },
      });
      if (existingProduct) {
        throw new ConflictException("Product with this SKU already exists");
      }
    }

    const categories = await this.categoryRepository.findBy({
      id: In(categoryIds),
    });
    if (categories.length !== categoryIds.length) {
      throw new NotFoundException("One or more categories not found");
    }
    const inactiveCategories = categories.filter((c) => c.status !== "active");
    if (inactiveCategories.length > 0) {
      throw new BadRequestException(
        `Categories not approved: ${inactiveCategories.map((c) => c.id).join(", ")}`,
      );
    }

    if (rest.brandId) {
      const brand = await this.brandRepository.findOne({
        where: { id: rest.brandId },
      });
      if (!brand) {
        throw new NotFoundException("Brand not found");
      }
      if (brand.status !== "active") {
        throw new BadRequestException("Brand has not been approved");
      }
    }

    const product = this.productRepository.create({ ...rest, categories });
    product.likesCount = 0;
    product.commentsCount = 0;
    product.sharesCount = 0;
    product.viewCount = 0;
    product.isFeatured = false;
    product.isTrending = false;
    product.rating = 0;
    product.ratingCount = 0;
    const saved = await this.productRepository.save(product);

    if (skuList && skuList.length > 0) {
      saved.skus = await this.upsertSkus(saved.id, skuList);
    } else {
      saved.skus = [];
    }

    await this.invalidateSearchCache();
    return saved;
  }

  async findAllProducts(
    query: GetProductsQueryDto,
  ): Promise<PaginatedResponse<Product>> {
    const cacheKey = this.buildSearchCacheKey(query);
    try {
      const cached = await this.cachedService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as PaginatedResponse<Product>;
      }
    } catch (err) {
      this.logger.warn("Search cache read failed", String(err));
    }

    const {
      page = 1,
      limit = 10,
      search,
      categoryIds,
      brandIds,
      minPrice,
      maxPrice,
      isActive,
      isFeatured,
      isTrending,
      condition,
      minRating,
      maxRating,
      sortBy = "id",
      sortOrder = "ASC",
      userId,
      skuSearch,
    } = query;

    // PERF-10: filter/paginate on product ids only (no joinAndSelect), then
    // hydrate relations via In(ids). Joining brand + categories (ManyToMany)
    // on a paginated list forced TypeORM into its distinct-subquery pagination
    // path with cartesian row inflation per category.
    const queryBuilder: SelectQueryBuilder<Product> =
      this.productRepository.createQueryBuilder("product");

    if (search) {
      queryBuilder.andWhere(
        "(product.name LIKE :search OR product.description LIKE :search OR product.sku LIKE :search)",
        { search: `%${search}%` },
      );
    }

    if (userId !== undefined) {
      queryBuilder.andWhere("product.userId = :userId", { userId });
    }

    if (skuSearch) {
      queryBuilder
        .leftJoin("product.skus", "sku")
        .andWhere("(product.sku LIKE :skuSearch OR sku.sku LIKE :skuSearch)", {
          skuSearch: `%${skuSearch}%`,
        });
    }

    if (categoryIds && categoryIds.length > 0) {
      // Join without select — only needed for the filter; full categories are
      // hydrated in the relation-load step below.
      queryBuilder
        .leftJoin("product.categories", "categories")
        .andWhere("categories.id IN (:...categoryIds)", {
          categoryIds,
        });
    }

    if (brandIds && brandIds.length > 0) {
      queryBuilder.andWhere("product.brandId IN (:...brandIds)", { brandIds });
    }

    if (minPrice !== undefined) {
      queryBuilder.andWhere("product.price >= :minPrice", { minPrice });
    }

    if (maxPrice !== undefined) {
      queryBuilder.andWhere("product.price <= :maxPrice", { maxPrice });
    }

    if (isActive !== undefined) {
      queryBuilder.andWhere("product.isActive = :isActive", { isActive });
    }

    if (isFeatured !== undefined) {
      queryBuilder.andWhere("product.isFeatured = :isFeatured", { isFeatured });
    }

    if (isTrending !== undefined) {
      queryBuilder.andWhere("product.isTrending = :isTrending", { isTrending });
    }

    if (condition) {
      queryBuilder.andWhere("product.condition = :condition", { condition });
    }

    if (minRating !== undefined) {
      queryBuilder.andWhere("product.rating >= :minRating", { minRating });
    }

    if (maxRating !== undefined) {
      queryBuilder.andWhere("product.rating <= :maxRating", { maxRating });
    }

    const skip = (page - 1) * limit;

    // Step 1: count + page ids on the filtered single-table query. DISTINCT
    // guards against row duplication from the to-many filter joins
    // (categories/sku); the sort column must be selected for MySQL to allow
    // DISTINCT + ORDER BY.
    const total = await queryBuilder.getCount();
    const pagedIdRows = await queryBuilder
      .clone()
      .select("product.id", "productId")
      .addSelect(`product.${sortBy}`, "sortValue")
      .distinct(true)
      .orderBy("sortValue", sortOrder)
      .offset(skip)
      .limit(limit)
      .getRawMany<{ productId: string }>();
    const pagedProductIds = pagedIdRows.map((row) => row.productId);

    // Step 2: hydrate the page's entities with relations, preserving the
    // sorted id order (In() gives no ordering guarantee).
    let data: Product[] = [];
    if (pagedProductIds.length > 0) {
      const products = await this.productRepository.find({
        where: { id: In(pagedProductIds) },
        relations: ["brand", "categories"],
      });
      const productById = new Map(
        products.map((product) => [String(product.id), product]),
      );
      data = pagedProductIds
        .map((id) => productById.get(String(id)))
        .filter((product): product is Product => product !== undefined);
    }

    const result = PaginatedResponse.of(data, total, page, limit);

    try {
      await this.cachedService.set(
        cacheKey,
        JSON.stringify(result),
        SEARCH_CACHE_TTL,
      );
    } catch (err) {
      this.logger.warn("Search cache write failed", String(err));
    }

    return result;
  }

  async findProductById(id: number): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ["brand", "categories", "skus"],
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    return product;
  }

  // Batch variant of findProductById (GAP-01). Missing ids are skipped —
  // callers treat absent products as deleted and fall back to snapshots/null.
  async findProductsByIds(ids: number[]): Promise<Product[]> {
    if (!Array.isArray(ids) || ids.length === 0) {
      return [];
    }
    return this.productRepository.find({
      where: { id: In(ids) },
      relations: ["brand", "categories", "skus"],
    });
  }

  async findProductBySku(sku: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { sku },
      relations: ["brand", "categories"],
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    return product;
  }

  async updateProduct(
    id: number,
    updateProductDto: UpdateProductDto,
  ): Promise<Product> {
    const product = await this.findProductById(id);

    if (updateProductDto.isActive === true && product.approvalBlocked) {
      throw new BadRequestException(
        "Product is blocked pending brand/category approval",
      );
    }

    if (updateProductDto.sku && updateProductDto.sku !== product.sku) {
      const existingProduct = await this.productRepository.findOne({
        where: { sku: updateProductDto.sku },
      });
      if (existingProduct) {
        throw new ConflictException("Product with this SKU already exists");
      }
    }

    if (updateProductDto.brandId) {
      const brand = await this.brandRepository.findOne({
        where: { id: updateProductDto.brandId },
      });
      if (!brand) {
        throw new NotFoundException("Brand not found");
      }
      if (brand.status !== "active") {
        throw new BadRequestException("Brand has not been approved");
      }
    }

    const { categoryIds, skuList, ...rest } = updateProductDto;
    Object.assign(product, rest);

    if (categoryIds) {
      const categories = await this.categoryRepository.findBy({
        id: In(categoryIds),
      });
      if (categories.length !== categoryIds.length) {
        throw new NotFoundException("One or more categories not found");
      }
      const inactiveCategories = categories.filter(
        (c) => c.status !== "active",
      );
      if (inactiveCategories.length > 0) {
        throw new BadRequestException(
          `Categories not approved: ${inactiveCategories.map((c) => c.id).join(", ")}`,
        );
      }
      product.categories = categories;
    }

    const updated = await this.productRepository.save(product);

    if (skuList !== undefined) {
      updated.skus = await this.upsertSkus(updated.id, skuList);
    }

    await this.invalidateSearchCache();
    return updated;
  }

  async deleteProduct(id: number): Promise<{ success: boolean }> {
    const product = await this.findProductById(id);
    await this.productRepository.remove(product);
    await this.invalidateSearchCache();
    return { success: true };
  }

  async findProductsByCategory(categoryId: number, query: GetProductsQueryDto) {
    return this.findAllProducts({ ...query, categoryIds: [categoryId] });
  }

  async findProductsByBrand(brandId: number, query: GetProductsQueryDto) {
    return this.findAllProducts({ ...query, brandIds: [brandId] });
  }

  // Review methods
  private async recalculateProductRating(productId: number): Promise<void> {
    const result = await this.reviewRepository
      .createQueryBuilder("review")
      .select("AVG(review.rating)", "avg")
      .addSelect("COUNT(review.id)", "count")
      .where("review.productId = :productId", { productId })
      .getRawOne<{ avg: string | null; count: string }>();

    await this.productRepository.update(productId, {
      rating: Number(result?.avg ?? 0),
      ratingCount: Number(result?.count ?? 0),
    });
  }

  async createReview(dto: {
    userId: number;
    productId: number;
    rating: number;
    comment?: string;
  }): Promise<ProductReview> {
    await this.findProductById(dto.productId);

    let review: ProductReview;
    try {
      review = await this.reviewRepository.save(
        this.reviewRepository.create({
          productId: dto.productId,
          userId: dto.userId,
          rating: dto.rating,
          comment: dto.comment ?? null,
        }),
      );
    } catch (err: unknown) {
      const dbErr = err as { code?: string };
      if (dbErr.code === "ER_DUP_ENTRY") {
        throw new ConflictException("Already reviewed this product");
      }
      throw err;
    }

    await this.recalculateProductRating(dto.productId);
    return review;
  }

  async deleteReview(reviewId: number, userId: number): Promise<void> {
    const review = await this.reviewRepository.findOne({
      where: { id: reviewId },
    });
    if (!review) {
      throw new NotFoundException("Review not found");
    }
    if (review.userId !== userId) {
      throw new ForbiddenException("Not your review");
    }
    await this.reviewRepository.remove(review);
    await this.recalculateProductRating(review.productId);
  }

  async findReviewsByProduct(
    productId: number,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<ProductReview>> {
    const [data, total] = await this.reviewRepository.findAndCount({
      where: { productId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return PaginatedResponse.of(data, total, page, limit);
  }

  // Brand methods
  async createBrand(
    createBrandDto: CreateBrandDto,
    submittedBy: number,
  ): Promise<Brand> {
    const brand = this.brandRepository.create({
      ...createBrandDto,
      status: "pending",
      isActive: false,
      submittedBy,
    });
    return this.brandRepository.save(brand);
  }

  async findAllBrands(
    status?: "pending" | "active" | "rejected",
  ): Promise<Brand[]> {
    return this.brandRepository.find({
      where: { status: status ?? "active" },
      order: { name: "ASC" },
    });
  }

  async findBrandById(id: number): Promise<Brand> {
    const brand = await this.brandRepository.findOne({
      where: { id },
    });
    if (!brand) {
      throw new NotFoundException("Brand not found");
    }
    return brand;
  }

  async reviewBrand(
    id: number,
    action: "approve" | "reject",
    note?: string,
  ): Promise<Brand> {
    const brand = await this.brandRepository.findOne({ where: { id } });
    if (!brand) {
      throw new NotFoundException("Brand not found");
    }
    brand.status = action === "approve" ? "active" : "rejected";
    brand.isActive = action === "approve";
    if (note !== undefined) {
      brand.reviewNote = note;
    }
    const saved = await this.brandRepository.save(brand);
    if (saved.status === "rejected") {
      const result = await this.productRepository.update(
        { brandId: saved.id },
        { approvalBlocked: true, isActive: false },
      );
      this.logger.log(
        `Brand ${saved.id} rejected: blocked ${result.affected ?? 0} products`,
      );
    }
    if (saved.status === "active") {
      const result = await this.productRepository.update(
        { brandId: saved.id },
        { approvalBlocked: false },
      );
      this.logger.log(
        `Brand ${saved.id} approved: unblocked ${result.affected ?? 0} products`,
      );
    }
    if (saved.submittedBy != null) {
      if (!this.fanoutChannel) {
        this.logger.warn(
          "[PRODUCT] fanoutChannel unavailable — brand_reviewed notification skipped",
        );
      } else {
        try {
          this.fanoutChannel.publish(
            EXCHANGE.PRODUCT_EXCHANGE,
            EVENT.BRAND_REVIEWED_EVENT,
            Buffer.from(
              JSON.stringify({
                pattern: EVENT.BRAND_REVIEWED_EVENT,
                data: {
                  submittedBy: saved.submittedBy,
                  brandId: saved.id,
                  brandName: saved.name,
                  action,
                  note: note ?? null,
                },
              }),
            ),
          );
        } catch (err) {
          this.logger.warn(
            `[PRODUCT] Failed to emit brand_reviewed event: ${String(err)}`,
          );
        }
      }
    }
    return saved;
  }

  // Category methods
  async createCategory(
    createCategoryDto: CreateCategoryDto,
    submittedBy: number,
  ): Promise<Category> {
    const category = this.categoryRepository.create({
      ...createCategoryDto,
      status: "pending",
      isActive: false,
      submittedBy,
    });
    return this.categoryRepository.save(category);
  }

  async findAllCategories(
    status?: "pending" | "active" | "rejected",
  ): Promise<Category[]> {
    return this.categoryRepository.find({
      where: { status: status ?? "active" },
      order: { name: "ASC" },
    });
  }

  async findCategoryById(id: number): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { id },
    });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }

  async reviewCategory(
    id: number,
    action: "approve" | "reject",
    note?: string,
  ): Promise<Category> {
    const category = await this.categoryRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    category.status = action === "approve" ? "active" : "rejected";
    category.isActive = action === "approve";
    if (note !== undefined) {
      category.reviewNote = note;
    }
    const saved = await this.categoryRepository.save(category);
    if (saved.status === "rejected") {
      const affected = await this.productRepository
        .createQueryBuilder("product")
        .innerJoin("product.categories", "cat", "cat.id = :catId", {
          catId: saved.id,
        })
        .select("product.id")
        .getMany();
      if (affected.length > 0) {
        await this.productRepository.update(
          { id: In(affected.map((p) => p.id)) },
          { approvalBlocked: true, isActive: false },
        );
      }
      this.logger.log(
        `Category ${saved.id} rejected: blocked ${affected.length} products`,
      );
    }
    if (saved.status === "active") {
      const affected = await this.productRepository
        .createQueryBuilder("product")
        .innerJoin("product.categories", "cat", "cat.id = :catId", {
          catId: saved.id,
        })
        .select("product.id")
        .getMany();
      if (affected.length > 0) {
        await this.productRepository.update(
          { id: In(affected.map((p) => p.id)) },
          { approvalBlocked: false },
        );
      }
      this.logger.log(
        `Category ${saved.id} approved: unblocked ${affected.length} products`,
      );
    }
    if (saved.submittedBy != null) {
      if (!this.fanoutChannel) {
        this.logger.warn(
          "[PRODUCT] fanoutChannel unavailable — category_reviewed notification skipped",
        );
      } else {
        try {
          this.fanoutChannel.publish(
            EXCHANGE.PRODUCT_EXCHANGE,
            EVENT.CATEGORY_REVIEWED_EVENT,
            Buffer.from(
              JSON.stringify({
                pattern: EVENT.CATEGORY_REVIEWED_EVENT,
                data: {
                  submittedBy: saved.submittedBy,
                  categoryId: saved.id,
                  categoryName: saved.name,
                  action,
                  note: note ?? null,
                },
              }),
            ),
          );
        } catch (err) {
          this.logger.warn(
            `[PRODUCT] Failed to emit category_reviewed event: ${String(err)}`,
          );
        }
      }
    }
    return saved;
  }

  async getProductIdsBySeller(sellerId: number): Promise<number[]> {
    const products = await this.productRepository.find({
      select: ["id"],
      where: { userId: sellerId, isActive: true },
    });
    return products.map((p) => p.id);
  }

  async addWishlistItem(
    userId: number,
    productId: number,
  ): Promise<WishlistMutationResult> {
    const product = await this.productRepository.findOne({
      select: ["id"],
      where: { id: productId, isActive: true },
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    try {
      const saved = await this.wishlistRepository.save(
        this.wishlistRepository.create({ userId, productId }),
      );
      return {
        productId,
        isWishlisted: true,
        createdAt: saved.createdAt,
      };
    } catch (err: unknown) {
      const dbErr = err as { code?: string };
      if (dbErr.code !== "ER_DUP_ENTRY") {
        throw err;
      }

      const existing = await this.wishlistRepository.findOne({
        where: { userId, productId },
      });
      return {
        productId,
        isWishlisted: true,
        createdAt: existing?.createdAt ?? new Date(),
      };
    }
  }

  async removeWishlistItem(userId: number, productId: number): Promise<null> {
    await this.wishlistRepository.delete({ userId, productId });
    return null;
  }

  async findWishlistByUser(
    userId: number,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponse<WishlistedProduct>> {
    const safePage = Math.max(1, Math.trunc(page));
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const [wishlistItems, total] = await this.wishlistRepository.findAndCount({
      where: { userId, product: { isActive: true } },
      relations: {
        product: {
          brand: true,
          categories: true,
        },
      },
      order: { createdAt: "DESC" },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const products = wishlistItems.map(
      (wishlistItem): WishlistedProduct => ({
        ...wishlistItem.product,
        wishlistedAt: wishlistItem.createdAt,
      }),
    );

    return PaginatedResponse.of(products, total, safePage, safeLimit);
  }
}
