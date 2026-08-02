import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  In,
  MoreThan,
  Raw,
  Repository,
  SelectQueryBuilder,
} from "typeorm";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout } from "rxjs";
import { Channel } from "amqplib";
import {
  CloudinaryService,
  generatePublicId,
  isPublicId,
  PaginatedResponse,
} from "@app/common";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";
import { CachedService } from "@app/cached";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { ORDER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { Product } from "./entity/product.entity";
import { ProductReview } from "./entity/product-review.entity";
import { ProductSku } from "./entity/product-sku.entity";
import { WishlistItem } from "./entity/wishlist-item.entity";
import { ProductRiskFeedback } from "./entity/product-risk-feedback.entity";
import { Brand } from "./entity/brand.entity";
import { Category } from "./entity/category.entity";
import { ProductImageHashService } from "./product-image-hash.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { CreateBrandDto } from "./dto/create-brand.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { GetProductsQueryDto } from "./dto/get-products-query.dto";
import { CreateProductSkuDto } from "./dto/create-product-sku.dto";
import { PRODUCT_MESSAGE } from "libs/constant/response-message.constant";
import {
  SEARCH_CACHE_TTL,
  CATALOG_LOOKUP_CACHE_TTL,
  CATALOG_LOOKUP_STATUSES,
  CATALOG_UNIQUE_STATUSES,
} from "./product.constants";
import {
  CatalogLookupStatus,
  WishlistMutationResult,
  WishlistedProduct,
  PriceSuggestion,
  PriceSuggestionQuery,
  PriceSuggestionRawRow,
} from "./product.types";
import {
  PRODUCT_RISK_WEIGHTS,
  ProductRiskFlag,
  ProductRiskBackfillRequest,
  ProductRiskBackfillResult,
  ProductDuplicateAdvisory,
  ProductRiskFeedbackRequest,
  ProductRiskFeedbackResult,
  ProductRiskQuery,
  ProductRiskSummary,
} from "./product-risk.types";

const RISK_SCORING_BATCH_SIZE = 3;
const RISK_SCORING_MAX_ATTEMPTS = 5;
const RISK_SCORING_ERROR_MAX_LENGTH = 500;

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);
  private isRiskScoringWorkerRunning = false;

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
    private readonly cloudinaryService: CloudinaryService,
    private readonly productImageHashService: ProductImageHashService,
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

  private buildBrandListCacheKey(status: CatalogLookupStatus): string {
    return `products:brands:${status}`;
  }

  private buildCategoryListCacheKey(status: CatalogLookupStatus): string {
    return `products:categories:${status}`;
  }

  private async readCachedList<T>(
    cacheKey: string,
    label: string,
  ): Promise<T[] | null> {
    try {
      const cached = await this.cachedService.get(cacheKey);
      if (!cached) {
        return null;
      }
      return JSON.parse(cached) as T[];
    } catch (err) {
      this.logger.warn(`${label} cache read failed`, String(err));
      return null;
    }
  }

  private async writeCachedList<T>(
    cacheKey: string,
    value: T[],
    label: string,
  ): Promise<void> {
    try {
      await this.cachedService.set(
        cacheKey,
        JSON.stringify(value),
        CATALOG_LOOKUP_CACHE_TTL,
      );
    } catch (err) {
      this.logger.warn(`${label} cache write failed`, String(err));
    }
  }

  private async invalidateBrandListCache(): Promise<void> {
    try {
      await Promise.all(
        CATALOG_LOOKUP_STATUSES.map((status) =>
          this.cachedService.del(this.buildBrandListCacheKey(status)),
        ),
      );
    } catch (err) {
      this.logger.warn("Failed to invalidate brand list cache", String(err));
    }
  }

  private async invalidateCategoryListCache(): Promise<void> {
    try {
      await Promise.all(
        CATALOG_LOOKUP_STATUSES.map((status) =>
          this.cachedService.del(this.buildCategoryListCacheKey(status)),
        ),
      );
    } catch (err) {
      this.logger.warn("Failed to invalidate category list cache", String(err));
    }
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
      throw new NotFoundException(PRODUCT_MESSAGE.NOT_FOUND_BY_ID(productId));
    }
    this.logger.log(
      `[PRODUCT] Updated stockQuantity for product ${productId} to ${availableStock}`,
    );
  }

  async getPriceSuggestion(
    query: PriceSuggestionQuery,
  ): Promise<PriceSuggestion> {
    const filters = [
      "pc.category_id = ?",
      "product.is_active = TRUE",
      "product.approval_blocked = FALSE",
      "COALESCE(sku.price, product.price) IS NOT NULL",
    ];
    const parameters: Array<number | string> = [query.categoryId];

    if (query.brandId !== undefined) {
      filters.push("product.brand_id = ?");
      parameters.push(query.brandId);
    }
    if (query.condition !== undefined) {
      filters.push("product.condition = ?");
      parameters.push(query.condition);
    }

    const rows = await this.productRepository.query<PriceSuggestionRawRow[]>(
      `
        WITH priced AS (
          SELECT
            COALESCE(sku.price, product.price) AS price,
            ROW_NUMBER() OVER (
              ORDER BY COALESCE(sku.price, product.price)
            ) AS rowNumber,
            COUNT(*) OVER () AS sampleSize
          FROM products product
          INNER JOIN product_categories pc ON pc.product_id = product.id
          LEFT JOIN product_skus sku
            ON sku.product_id = product.id AND sku.is_active = TRUE
          WHERE ${filters.join(" AND ")}
        )
        SELECT
          COUNT(*) AS sampleSize,
          ROUND(AVG(CASE
            WHEN rowNumber IN (
              FLOOR((sampleSize + 1) / 2),
              CEIL((sampleSize + 1) / 2)
            ) THEN price
          END)) AS median,
          ROUND(MAX(CASE
            WHEN rowNumber = CEIL(sampleSize * 0.25) THEN price
          END)) AS p25,
          ROUND(MAX(CASE
            WHEN rowNumber = CEIL(sampleSize * 0.75) THEN price
          END)) AS p75,
          ROUND(MIN(price)) AS min,
          ROUND(MAX(price)) AS max
        FROM priced
      `,
      parameters,
    );
    const stats = rows[0];
    const sampleSize = Number(stats?.sampleSize ?? 0);

    if (sampleSize < 3) {
      return {
        sufficientData: false,
        sampleSize,
        median: null,
        p25: null,
        p75: null,
        min: null,
        max: null,
      };
    }

    return {
      sufficientData: true,
      sampleSize,
      median: this.toRoundedNumber(stats?.median),
      p25: this.toRoundedNumber(stats?.p25),
      p75: this.toRoundedNumber(stats?.p75),
      min: this.toRoundedNumber(stats?.min),
      max: this.toRoundedNumber(stats?.max),
    };
  }

  private toRoundedNumber(
    value: string | number | null | undefined,
  ): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    return Math.round(Number(value));
  }

  async findProductRisks(
    query: ProductRiskQuery,
  ): Promise<PaginatedResponse<Product>> {
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 20)));
    const minScore = Math.min(
      100,
      Math.max(0, Math.trunc(query.minScore ?? 1)),
    );

    const [products, total] = await this.productRepository
      .createQueryBuilder("product")
      .addSelect("product.riskScore")
      .addSelect("product.riskFlags")
      .addSelect("product.riskScoringStatus")
      .addSelect("product.riskScoredAt")
      .addSelect("product.riskScoringAttempts")
      .addSelect("product.riskNextRetryAt")
      .addSelect("product.riskLastError")
      .leftJoinAndSelect("product.brand", "brand")
      .leftJoinAndSelect("product.categories", "category")
      .where("product.riskScore >= :minScore", { minScore })
      .orderBy("product.riskScore", "DESC")
      .addOrderBy("product.updatedAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const normalizedProducts = products.map((product) => ({
      ...product,
      riskScore: product.riskScore ?? 0,
      riskFlags: product.riskFlags ?? [],
    }));

    return PaginatedResponse.of(normalizedProducts, total, page, limit);
  }

  async rescoreProduct(productId: number): Promise<ProductRiskSummary> {
    try {
      return await this.calculateAndPersistProductRisk(productId);
    } catch (error: unknown) {
      await this.markRiskScoringFailed(productId, error);
      throw error;
    }
  }

  private async calculateAndPersistProductRisk(
    productId: number,
  ): Promise<ProductRiskSummary> {
    const product = await this.productRepository
      .createQueryBuilder("product")
      .addSelect("product.imagePhashes")
      .addSelect("product.riskScore")
      .addSelect("product.riskFlags")
      .leftJoinAndSelect("product.categories", "category")
      .leftJoinAndSelect("product.skus", "sku")
      .where("product.id = :productId", { productId })
      .getOne();
    if (!product) {
      throw new NotFoundException(PRODUCT_MESSAGE.NOT_FOUND);
    }

    const imagePhashes = await this.productImageHashService.hashImageUrls(
      product.imageUrls ?? [],
    );
    const candidates = await this.productRepository
      .createQueryBuilder("candidate")
      .addSelect("candidate.imagePhashes")
      .leftJoinAndSelect("candidate.categories", "candidateCategory")
      .where("candidate.id != :productId", { productId })
      .andWhere("candidate.isActive = TRUE")
      .getMany();

    const riskFlags: ProductRiskFlag[] = [];
    const duplicateImageFlag = this.findDuplicateImageRisk(
      product,
      imagePhashes,
      candidates,
    );
    if (duplicateImageFlag) {
      riskFlags.push(duplicateImageFlag);
    }

    const priceAnomalyFlag = await this.findPriceAnomalyRisk(product);
    if (priceAnomalyFlag) {
      riskFlags.push(priceAnomalyFlag);
    }

    const similarNameFlag = this.findSimilarNameRisk(product, candidates);
    if (similarNameFlag) {
      riskFlags.push(similarNameFlag);
    }

    const riskScore = Math.min(
      100,
      riskFlags.reduce((score, flag) => score + flag.weight, 0),
    );
    const riskScoredAt = new Date();
    await this.productRepository.update(productId, {
      imagePhashes: imagePhashes.length > 0 ? imagePhashes : null,
      riskScore,
      riskFlags: riskFlags.length > 0 ? riskFlags : null,
      riskScoringStatus: "ready",
      riskScoredAt,
      riskScoringAttempts: 0,
      riskNextRetryAt: null,
      riskLastError: null,
    });

    return {
      productId,
      riskScore,
      riskFlags,
      riskScoringStatus: "ready",
      riskScoredAt,
    };
  }

  private async markRiskScoringFailed(
    productId: number,
    error: unknown,
  ): Promise<void> {
    const product = await this.productRepository.findOne({
      where: { id: productId },
      select: ["id", "riskScoringAttempts"],
    });
    if (!product) return;

    const attempts = Math.min(
      RISK_SCORING_MAX_ATTEMPTS,
      (product.riskScoringAttempts ?? 0) + 1,
    );
    const retryDelayMs = Math.min(60 * 60 * 1000, 60_000 * 2 ** attempts);
    const message = error instanceof Error ? error.message : String(error);
    await this.productRepository.update(productId, {
      riskScoringStatus: "failed",
      riskScoringAttempts: attempts,
      riskNextRetryAt:
        attempts < RISK_SCORING_MAX_ATTEMPTS
          ? new Date(Date.now() + retryDelayMs)
          : null,
      riskLastError: message.slice(0, RISK_SCORING_ERROR_MAX_LENGTH),
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processRiskScoringQueue(): Promise<void> {
    if (this.isRiskScoringWorkerRunning) return;
    this.isRiskScoringWorkerRunning = true;
    try {
      const dueProducts = await this.productRepository
        .createQueryBuilder("product")
        .addSelect("product.riskScoringAttempts")
        .where(
          "product.riskScoringStatus = :pending OR (product.riskScoringStatus = :failed AND product.riskScoringAttempts < :maxAttempts AND product.riskNextRetryAt <= :now)",
          {
            pending: "pending",
            failed: "failed",
            maxAttempts: RISK_SCORING_MAX_ATTEMPTS,
            now: new Date(),
          },
        )
        .orderBy("product.id", "ASC")
        .take(RISK_SCORING_BATCH_SIZE)
        .getMany();

      await Promise.all(
        dueProducts.map(async (product) => {
          try {
            await this.calculateAndPersistProductRisk(Number(product.id));
          } catch (error: unknown) {
            await this.markRiskScoringFailed(Number(product.id), error);
            this.logger.warn(
              `Risk scoring failed for product ${product.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
      );
    } finally {
      this.isRiskScoringWorkerRunning = false;
    }
  }

  async enqueueRiskBackfill(
    request: ProductRiskBackfillRequest,
  ): Promise<ProductRiskBackfillResult> {
    const cursor = Math.max(0, Math.trunc(request.cursor ?? 0));
    const limit = Math.min(100, Math.max(1, Math.trunc(request.limit ?? 50)));
    const products = await this.productRepository.find({
      where: { id: MoreThan(cursor) },
      select: ["id"],
      order: { id: "ASC" },
      take: limit + 1,
    });
    const page = products.slice(0, limit);
    const productIds = page.map((product) => Number(product.id));
    if (productIds.length > 0) {
      await this.productRepository.update(
        { id: In(productIds) },
        {
          riskScoringStatus: "pending",
          riskScoringAttempts: 0,
          riskNextRetryAt: null,
          riskLastError: null,
        },
      );
      void this.processRiskScoringQueue();
    }
    return {
      enqueued: productIds.length,
      nextCursor: productIds.at(-1) ?? null,
      hasMore: products.length > limit,
    };
  }

  async checkDuplicateImage(
    sellerId: number,
    imageUrl: string,
  ): Promise<ProductDuplicateAdvisory> {
    const hashes = await this.productImageHashService.hashImageUrls([imageUrl]);
    if (hashes.length === 0) {
      return { duplicateLikely: false, match: null };
    }
    const candidates = await this.productRepository
      .createQueryBuilder("product")
      .addSelect("product.imagePhashes")
      .where("product.isActive = TRUE")
      .andWhere("product.userId != :sellerId", { sellerId })
      .andWhere("product.imagePhashes IS NOT NULL")
      .getMany();

    let closest:
      | { product: Product; hammingDistance: number; evidenceCount: number }
      | undefined;
    for (const candidate of candidates) {
      let evidenceCount = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const hash of hashes) {
        for (const candidateHash of candidate.imagePhashes ?? []) {
          const hammingDistance = this.calculateHammingDistance(
            hash,
            candidateHash,
          );
          if (hammingDistance <= 6) {
            evidenceCount += 1;
            closestDistance = Math.min(closestDistance, hammingDistance);
          }
        }
      }
      const hasStrongEvidence = closestDistance <= 2 || evidenceCount >= 2;
      if (
        hasStrongEvidence &&
        (!closest || closestDistance < closest.hammingDistance)
      ) {
        closest = {
          product: candidate,
          hammingDistance: closestDistance,
          evidenceCount,
        };
      }
    }

    return closest
      ? {
          duplicateLikely: true,
          match: {
            productId: Number(closest.product.id),
            name: closest.product.name,
            imageUrl: closest.product.imageUrls?.[0] ?? null,
            hammingDistance: closest.hammingDistance,
            evidenceCount: closest.evidenceCount,
          },
        }
      : { duplicateLikely: false, match: null };
  }

  async recordRiskFeedback(
    request: ProductRiskFeedbackRequest,
  ): Promise<ProductRiskFeedbackResult> {
    const product = await this.productRepository.findOne({
      where: { id: request.productId },
      select: ["id"],
    });
    if (!product) {
      throw new NotFoundException(PRODUCT_MESSAGE.NOT_FOUND);
    }
    const feedbackRepository =
      this.dataSource.getRepository(ProductRiskFeedback);
    const existing = await feedbackRepository.findOne({
      where: { productId: request.productId },
    });
    const feedback = feedbackRepository.create({
      ...existing,
      productId: request.productId,
      moderatorId: request.moderatorId,
      decision: request.decision,
      note: request.note?.trim() || null,
    });
    const saved = await feedbackRepository.save(feedback);
    return {
      productId: saved.productId,
      moderatorId: saved.moderatorId,
      decision: saved.decision,
      note: saved.note,
      updatedAt: saved.updatedAt,
    };
  }

  private findDuplicateImageRisk(
    product: Product,
    imagePhashes: string[],
    candidates: Product[],
  ): ProductRiskFlag | null {
    if (imagePhashes.length === 0) {
      return null;
    }

    let closestMatch:
      | {
          matchedProductId: number;
          hammingDistance: number;
          evidenceCount: number;
        }
      | undefined;
    for (const candidate of candidates) {
      if (!this.isDifferentSeller(product, candidate)) {
        continue;
      }
      let evidenceCount = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const imagePhash of imagePhashes) {
        for (const candidatePhash of candidate.imagePhashes ?? []) {
          const hammingDistance = this.calculateHammingDistance(
            imagePhash,
            candidatePhash,
          );
          if (hammingDistance <= 6) {
            evidenceCount += 1;
            closestDistance = Math.min(closestDistance, hammingDistance);
          }
        }
      }
      const hasStrongEvidence = closestDistance <= 2 || evidenceCount >= 2;
      if (
        hasStrongEvidence &&
        (!closestMatch || closestDistance < closestMatch.hammingDistance)
      ) {
        closestMatch = {
          matchedProductId: Number(candidate.id),
          hammingDistance: closestDistance,
          evidenceCount,
        };
      }
    }

    return closestMatch
      ? {
          type: "duplicate_image",
          weight: PRODUCT_RISK_WEIGHTS.duplicateImage,
          ...closestMatch,
        }
      : null;
  }

  private async findPriceAnomalyRisk(
    product: Product,
  ): Promise<ProductRiskFlag | null> {
    const productPrice = this.getEffectiveProductPrice(product);
    if (productPrice === null || product.categories.length === 0) {
      return null;
    }

    const suggestions = await Promise.all(
      product.categories.map((category) =>
        this.getPriceSuggestion({
          categoryId: category.id,
        }),
      ),
    );
    const medians = suggestions
      .map((suggestion) => suggestion.median)
      .filter((median): median is number => median !== null && median > 0);
    if (medians.length === 0) {
      return null;
    }

    const categoryMedian = Math.min(...medians);
    const ratio = productPrice / categoryMedian;
    return ratio < 0.4
      ? {
          type: "price_anomaly",
          weight: PRODUCT_RISK_WEIGHTS.priceAnomaly,
          productPrice,
          categoryMedian,
          ratio: Number(ratio.toFixed(3)),
        }
      : null;
  }

  private findSimilarNameRisk(
    product: Product,
    candidates: Product[],
  ): ProductRiskFlag | null {
    const categoryIds = new Set(
      product.categories.map((category) => category.id),
    );
    let closestMatch:
      | { matchedProductId: number; similarity: number }
      | undefined;

    for (const candidate of candidates) {
      const sharesCategory = candidate.categories.some((category) =>
        categoryIds.has(category.id),
      );
      if (!sharesCategory || !this.isDifferentSeller(product, candidate)) {
        continue;
      }

      const similarity = this.calculateTrigramSimilarity(
        product.name,
        candidate.name,
      );
      if (
        similarity >= 0.8 &&
        (!closestMatch || similarity > closestMatch.similarity)
      ) {
        closestMatch = {
          matchedProductId: Number(candidate.id),
          similarity: Number(similarity.toFixed(3)),
        };
      }
    }

    return closestMatch
      ? {
          type: "similar_name",
          weight: PRODUCT_RISK_WEIGHTS.similarName,
          ...closestMatch,
        }
      : null;
  }

  private getEffectiveProductPrice(product: Product): number | null {
    const prices = [
      product.price,
      ...(product.skus ?? [])
        .filter((sku) => sku.isActive)
        .map((sku) => Number(sku.price)),
    ].filter((price): price is number => price !== null && price !== undefined);
    return prices.length > 0 ? Math.min(...prices) : null;
  }

  private isDifferentSeller(product: Product, candidate: Product): boolean {
    return (
      product.userId !== undefined &&
      candidate.userId !== undefined &&
      Number(product.userId) !== Number(candidate.userId)
    );
  }

  private calculateHammingDistance(
    firstHash: string,
    secondHash: string,
  ): number {
    if (firstHash.length !== secondHash.length) {
      return Number.POSITIVE_INFINITY;
    }

    let distance = 0;
    for (let index = 0; index < firstHash.length; index += 1) {
      const xor =
        Number.parseInt(firstHash[index], 16) ^
        Number.parseInt(secondHash[index], 16);
      distance += xor.toString(2).replaceAll("0", "").length;
    }
    return distance;
  }

  private calculateTrigramSimilarity(
    firstName: string,
    secondName: string,
  ): number {
    const firstTrigrams = this.toTrigrams(firstName);
    const secondTrigrams = this.toTrigrams(secondName);
    if (firstTrigrams.size === 0 || secondTrigrams.size === 0) {
      return 0;
    }

    const intersectionSize = [...firstTrigrams].filter((trigram) =>
      secondTrigrams.has(trigram),
    ).length;
    const unionSize = new Set([...firstTrigrams, ...secondTrigrams]).size;
    return intersectionSize / unionSize;
  }

  private toTrigrams(name: string): Set<string> {
    const normalizedName = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
    if (normalizedName.length < 3) {
      return normalizedName ? new Set([normalizedName]) : new Set();
    }

    return new Set(
      Array.from({ length: normalizedName.length - 2 }, (_, index) =>
        normalizedName.slice(index, index + 3),
      ),
    );
  }

  private scheduleRiskRescore(): void {
    void this.processRiskScoringQueue();
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
          PRODUCT_MESSAGE.INVALID_TIER_IDX_JSON_STRING(dto.tierIdx),
        );
      }

      if (!Array.isArray(tierIdx)) {
        throw new BadRequestException(
          PRODUCT_MESSAGE.INVALID_TIER_IDX_ARRAY(dto.tierIdx),
        );
      }

      if (tierIdx.length !== variationCount) {
        throw new BadRequestException(
          PRODUCT_MESSAGE.TIER_IDX_COUNT_MISMATCH(
            dto.tierIdx,
            tierIdx.length,
            variationCount,
          ),
        );
      }

      tierIdx.forEach((idx, axis) => {
        const optionCount = axes[axis]?.options?.length ?? 0;
        if (!Number.isInteger(idx) || idx < 0 || idx >= optionCount) {
          throw new BadRequestException(
            PRODUCT_MESSAGE.TIER_IDX_OUT_OF_RANGE(
              dto.tierIdx,
              idx,
              axes[axis]?.name ?? axis,
              optionCount,
            ),
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
      throw new NotFoundException(PRODUCT_MESSAGE.NOT_FOUND_BY_ID(productId));
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
      throw new NotFoundException(PRODUCT_MESSAGE.SKU_NOT_FOUND(id));
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
        throw new ConflictException(PRODUCT_MESSAGE.SKU_ALREADY_EXISTS);
      }
    }

    const categories = await this.categoryRepository.findBy({
      id: In(categoryIds),
    });
    if (categories.length !== categoryIds.length) {
      throw new NotFoundException(PRODUCT_MESSAGE.CATEGORIES_NOT_FOUND);
    }
    const inactiveCategories = categories.filter((c) => c.status !== "active");
    if (inactiveCategories.length > 0) {
      throw new BadRequestException(
        PRODUCT_MESSAGE.CATEGORIES_NOT_APPROVED(
          inactiveCategories.map((c) => c.id).join(", "),
        ),
      );
    }

    if (rest.brandId) {
      const brand = await this.brandRepository.findOne({
        where: { id: rest.brandId },
      });
      if (!brand) {
        throw new NotFoundException(PRODUCT_MESSAGE.BRAND_NOT_FOUND);
      }
      if (brand.status !== "active") {
        throw new BadRequestException(PRODUCT_MESSAGE.BRAND_NOT_APPROVED);
      }
    }

    const product = this.productRepository.create({
      ...rest,
      publicId: generatePublicId(PUBLIC_ID_PREFIXES.PRODUCT),
      categories,
    });
    product.likesCount = 0;
    product.commentsCount = 0;
    product.sharesCount = 0;
    product.viewCount = 0;
    product.isFeatured = false;
    product.isTrending = false;
    product.rating = 0;
    product.ratingCount = 0;
    product.riskScoringStatus = "pending";
    product.riskScoringAttempts = 0;
    product.riskScoredAt = null;
    product.riskNextRetryAt = null;
    product.riskLastError = null;
    const saved = await this.productRepository.save(product);

    if (skuList && skuList.length > 0) {
      saved.skus = await this.upsertSkus(saved.id, skuList);
    } else {
      saved.skus = [];
    }

    await this.invalidateSearchCache();
    this.scheduleRiskRescore();
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
      userIds,
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

    if (userIds && userIds.length > 0) {
      queryBuilder.andWhere("product.userId IN (:...userIds)", { userIds });
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
      throw new NotFoundException(PRODUCT_MESSAGE.NOT_FOUND);
    }
    return product;
  }

  async resolveProductId(productId: number | string): Promise<number> {
    if (typeof productId === "number") {
      return productId;
    }
    if (!isPublicId(PUBLIC_ID_PREFIXES.PRODUCT, productId)) {
      throw new NotFoundException(PRODUCT_MESSAGE.NOT_FOUND);
    }
    const product = await this.productRepository.findOne({
      where: { publicId: productId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(PRODUCT_MESSAGE.NOT_FOUND);
    }
    return Number(product.id);
  }

  async resolveProductIds(productIds: (number | string)[]): Promise<number[]> {
    return Promise.all(
      productIds.map((productId) => this.resolveProductId(productId)),
    );
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
      throw new NotFoundException(PRODUCT_MESSAGE.NOT_FOUND);
    }
    return product;
  }

  // Fire-and-forget post-commit cleanup — destroyAssets never throws, so a
  // Cloudinary failure can never fail the product mutation that triggered it.
  private destroyDroppedImages(oldUrls: string[], keptUrls: string[]): void {
    const keptUrlSet = new Set(keptUrls);
    const droppedUrls = oldUrls.filter((imageUrl) => !keptUrlSet.has(imageUrl));
    if (droppedUrls.length === 0) return;
    void this.cloudinaryService.destroyAssets(droppedUrls);
  }

  // Fields whose change invalidates the stored risk score / image hashes.
  private needsRiskRescore(updateProductDto: UpdateProductDto): boolean {
    return (
      updateProductDto.imageUrls !== undefined ||
      updateProductDto.name !== undefined ||
      updateProductDto.price !== undefined ||
      updateProductDto.categoryIds !== undefined ||
      updateProductDto.brandId !== undefined ||
      updateProductDto.condition !== undefined ||
      updateProductDto.skuList !== undefined
    );
  }

  // TypeORM wraps driver errors in QueryFailedError; older paths put the code
  // on the error itself, newer ones only on driverError. Check both.
  private getDriverErrorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const candidate = error as {
      code?: unknown;
      driverError?: { code?: unknown };
    };
    if (typeof candidate.code === "string") return candidate.code;
    if (typeof candidate.driverError?.code === "string") {
      return candidate.driverError.code;
    }
    return undefined;
  }

  // Only claim a duplicate-sku conflict when the driver message actually names
  // the sku we tried to write — other unique indexes must keep their own error.
  private isDuplicateEntryFor(error: unknown, sku: string): boolean {
    if (this.getDriverErrorCode(error) !== "ER_DUP_ENTRY") return false;
    const message =
      error instanceof Error ? error.message : JSON.stringify(error ?? "");
    return message.includes(sku);
  }

  // InnoDB can still pick this transaction as the deadlock victim (e.g. against
  // an unrelated writer). One retry turns that into a normal serialized run.
  private async runProductUpdate<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (this.getDriverErrorCode(error) !== "ER_LOCK_DEADLOCK") {
        throw error;
      }
      this.logger.warn("Product update hit a deadlock — retrying once");
      return operation();
    }
  }

  /**
   * Read-modify-write of a single product, serialized against every other
   * writer of the same row.
   *
   * The row lock is taken BEFORE anything else on purpose: rewriting the
   * `product_categories` junction makes InnoDB take a shared FK lock on this
   * same products row, and the entity UPDATE that follows needs an exclusive
   * one — two concurrent edits used to deadlock on that S->X upgrade and
   * surface as a 502 (plus a merged category set nobody asked for).
   */
  private async applyProductUpdate(
    id: number,
    updateProductDto: UpdateProductDto,
  ): Promise<{ updated: Product; previousImageUrls: string[] }> {
    return this.dataSource.transaction(async (manager) => {
      const lockedRow = await manager
        .createQueryBuilder(Product, "product")
        .setLock("pessimistic_write")
        .select("product.id")
        .where("product.id = :id", { id })
        .getRawOne<{ product_id: string }>();
      if (!lockedRow) {
        throw new NotFoundException(PRODUCT_MESSAGE.NOT_FOUND);
      }

      const product = await manager.findOne(Product, {
        where: { id },
        relations: ["brand", "categories", "skus"],
      });
      if (!product) {
        throw new NotFoundException(PRODUCT_MESSAGE.NOT_FOUND);
      }
      // Capture before Object.assign overwrites imageUrls on the same instance.
      const previousImageUrls = product.imageUrls ?? [];

      if (
        updateProductDto.version !== undefined &&
        updateProductDto.version !== product.version
      ) {
        throw new ConflictException(PRODUCT_MESSAGE.VERSION_CONFLICT);
      }

      if (updateProductDto.isActive === true && product.approvalBlocked) {
        throw new BadRequestException(PRODUCT_MESSAGE.BLOCKED_PENDING_APPROVAL);
      }

      if (updateProductDto.sku && updateProductDto.sku !== product.sku) {
        const existingProduct = await manager.findOne(Product, {
          where: { sku: updateProductDto.sku },
        });
        if (existingProduct) {
          throw new ConflictException(PRODUCT_MESSAGE.SKU_ALREADY_EXISTS);
        }
      }

      if (updateProductDto.brandId) {
        const brand = await manager.findOne(Brand, {
          where: { id: updateProductDto.brandId },
        });
        if (!brand) {
          throw new NotFoundException(PRODUCT_MESSAGE.BRAND_NOT_FOUND);
        }
        if (brand.status !== "active") {
          throw new BadRequestException(PRODUCT_MESSAGE.BRAND_NOT_APPROVED);
        }
      }

      // categoryIds is applied through the relation, skuList in its own
      // transaction after commit, and version is a read-only concurrency token.
      const { categoryIds } = updateProductDto;
      const rest = { ...updateProductDto };
      delete rest.categoryIds;
      delete rest.skuList;
      delete rest.version;
      Object.assign(product, rest);

      if (categoryIds) {
        const categories = await manager.findBy(Category, {
          id: In(categoryIds),
        });
        if (categories.length !== categoryIds.length) {
          throw new NotFoundException(PRODUCT_MESSAGE.CATEGORIES_NOT_FOUND);
        }
        const inactiveCategories = categories.filter(
          (c) => c.status !== "active",
        );
        if (inactiveCategories.length > 0) {
          throw new BadRequestException(
            PRODUCT_MESSAGE.CATEGORIES_NOT_APPROVED(
              inactiveCategories.map((c) => c.id).join(", "),
            ),
          );
        }
        product.categories = categories;
      }

      // Folded into the same save so a content edit costs ONE row write: a
      // separate .update() would bump the version column a second time and make
      // the version returned to the caller immediately stale.
      if (this.needsRiskRescore(updateProductDto)) {
        product.riskScoringStatus = "pending";
        product.riskScoringAttempts = 0;
        product.riskNextRetryAt = null;
        product.riskLastError = null;
      }

      const updated = await manager.save(product);
      return { updated, previousImageUrls };
    });
  }

  async updateProduct(
    id: number,
    updateProductDto: UpdateProductDto,
  ): Promise<Product> {
    const { skuList } = updateProductDto;
    const { updated, previousImageUrls } = await this.runProductUpdate(() =>
      this.applyProductUpdate(id, updateProductDto),
    ).catch((error: unknown) => {
      // Two products can claim the same new sku at once: both pass the
      // check-then-act guard above and the loser hits the unique index. Report
      // the intended conflict instead of leaking a driver error as a 502.
      if (
        typeof updateProductDto.sku === "string" &&
        this.isDuplicateEntryFor(error, updateProductDto.sku)
      ) {
        throw new ConflictException(PRODUCT_MESSAGE.SKU_ALREADY_EXISTS);
      }
      throw error;
    });

    if (skuList !== undefined) {
      updated.skus = await this.upsertSkus(updated.id, skuList);
    }

    await this.invalidateSearchCache();
    // SEC-M7: dropped images are orphaned on Cloudinary once the edit commits.
    this.destroyDroppedImages(previousImageUrls, updated.imageUrls ?? []);
    // The risk state itself was already reset inside the update transaction.
    if (this.needsRiskRescore(updateProductDto)) {
      this.scheduleRiskRescore();
    }
    return updated;
  }

  async deleteProduct(id: number): Promise<{ success: boolean }> {
    const product = await this.findProductById(id);
    const removedImageUrls = product.imageUrls ?? [];
    await this.productRepository.remove(product);
    await this.invalidateSearchCache();
    this.destroyDroppedImages(removedImageUrls, []);
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
        throw new ConflictException(PRODUCT_MESSAGE.ALREADY_REVIEWED);
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
      throw new NotFoundException(PRODUCT_MESSAGE.REVIEW_NOT_FOUND);
    }
    if (review.userId !== userId) {
      throw new ForbiddenException(PRODUCT_MESSAGE.NOT_YOUR_REVIEW);
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
    const normalizedName = createBrandDto.name.trim();
    const existingBrand = await this.brandRepository.findOne({
      where: {
        name: Raw((alias) => `LOWER(TRIM(${alias})) = LOWER(:name)`, {
          name: normalizedName,
        }),
        status: In([...CATALOG_UNIQUE_STATUSES]),
      },
    });
    if (existingBrand) {
      throw new ConflictException(PRODUCT_MESSAGE.BRAND_NAME_TAKEN);
    }
    const brand = this.brandRepository.create({
      ...createBrandDto,
      name: normalizedName,
      status: "pending",
      isActive: false,
      submittedBy,
    });
    const saved = await this.brandRepository.save(brand);
    await this.invalidateBrandListCache();
    return saved;
  }

  async findAllBrands(status?: CatalogLookupStatus): Promise<Brand[]> {
    const resolvedStatus = status ?? "active";
    const cacheKey = this.buildBrandListCacheKey(resolvedStatus);
    const cached = await this.readCachedList<Brand>(cacheKey, "Brand list");
    if (cached) {
      return cached;
    }

    const brands = await this.brandRepository.find({
      where: { status: resolvedStatus },
      order: { name: "ASC" },
    });
    await this.writeCachedList(cacheKey, brands, "Brand list");
    return brands;
  }

  async findBrandById(id: number): Promise<Brand> {
    const brand = await this.brandRepository.findOne({
      where: { id },
    });
    if (!brand) {
      throw new NotFoundException(PRODUCT_MESSAGE.BRAND_NOT_FOUND);
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
      throw new NotFoundException(PRODUCT_MESSAGE.BRAND_NOT_FOUND);
    }
    brand.status = action === "approve" ? "active" : "rejected";
    brand.isActive = action === "approve";
    if (note !== undefined) {
      brand.reviewNote = note;
    }
    const saved = await this.brandRepository.save(brand);
    await this.invalidateBrandListCache();
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
    const normalizedName = createCategoryDto.name.trim();
    const existingCategory = await this.categoryRepository.findOne({
      where: {
        name: Raw((alias) => `LOWER(TRIM(${alias})) = LOWER(:name)`, {
          name: normalizedName,
        }),
        status: In([...CATALOG_UNIQUE_STATUSES]),
      },
    });
    if (existingCategory) {
      throw new ConflictException(PRODUCT_MESSAGE.CATEGORY_NAME_TAKEN);
    }
    const category = this.categoryRepository.create({
      ...createCategoryDto,
      name: normalizedName,
      status: "pending",
      isActive: false,
      submittedBy,
    });
    const saved = await this.categoryRepository.save(category);
    await this.invalidateCategoryListCache();
    return saved;
  }

  async findAllCategories(status?: CatalogLookupStatus): Promise<Category[]> {
    const resolvedStatus = status ?? "active";
    const cacheKey = this.buildCategoryListCacheKey(resolvedStatus);
    const cached = await this.readCachedList<Category>(
      cacheKey,
      "Category list",
    );
    if (cached) {
      return cached;
    }

    const categories = await this.categoryRepository.find({
      where: { status: resolvedStatus },
      order: { name: "ASC" },
    });
    await this.writeCachedList(cacheKey, categories, "Category list");
    return categories;
  }

  async findCategoryById(id: number): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { id },
    });
    if (!category) {
      throw new NotFoundException(PRODUCT_MESSAGE.CATEGORY_NOT_FOUND);
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
      throw new NotFoundException(PRODUCT_MESSAGE.CATEGORY_NOT_FOUND);
    }
    category.status = action === "approve" ? "active" : "rejected";
    category.isActive = action === "approve";
    if (note !== undefined) {
      category.reviewNote = note;
    }
    const saved = await this.categoryRepository.save(category);
    await this.invalidateCategoryListCache();
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
      throw new NotFoundException(PRODUCT_MESSAGE.NOT_FOUND);
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
