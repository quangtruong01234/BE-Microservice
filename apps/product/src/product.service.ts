import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository, SelectQueryBuilder } from "typeorm";
import { PaginatedResponse } from "@app/common";
import { CachedService } from "@app/cached";
import { Product } from "./entity/product.entity";
import { ProductSku } from "./entity/product-sku.entity";
import { Brand } from "./entity/brand.entity";
import { Category } from "./entity/category.entity";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { CreateBrandDto } from "./dto/create-brand.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { GetProductsQueryDto } from "./dto/get-products-query.dto";
import {
  CreateProductSkuDto,
  UpdateProductSkuDto,
} from "./dto/create-product-sku.dto";

const SEARCH_CACHE_TTL = 5; // seconds

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
    @InjectRepository(ProductSku)
    private readonly skuRepository: Repository<ProductSku>,
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
  ) {}

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

  // SKU methods
  async upsertSkus(
    productId: number,
    skuList: CreateProductSkuDto[],
  ): Promise<ProductSku[]> {
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(ProductSku, { productId });
      const entities = skuList.map((dto) =>
        manager.create(ProductSku, {
          productId,
          tierIdx: dto.tierIdx,
          price: dto.price,
          stockQuantity: dto.stockQuantity ?? 0,
          sku: dto.sku ?? null,
          isActive: dto.isActive ?? true,
        }),
      );
      const saved = await manager.save(ProductSku, entities);
      for (const sku of saved) {
        if (typeof sku.tierIdx === 'string') {
          sku.tierIdx = JSON.parse(sku.tierIdx) as number[];
        }
      }
      return saved;
    });
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

  async updateSku(id: number, dto: UpdateProductSkuDto): Promise<ProductSku> {
    const sku = await this.findSkuById(id);
    Object.assign(sku, dto);
    return this.skuRepository.save(sku);
  }

  async deleteSku(id: number): Promise<{ success: boolean }> {
    await this.findSkuById(id);
    await this.skuRepository.delete(id);
    return { success: true };
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

    if (rest.brandId) {
      const brand = await this.brandRepository.findOne({
        where: { id: rest.brandId },
      });
      if (!brand) {
        throw new NotFoundException("Brand not found");
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
      categoryId,
      brandId,
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
    } = query;

    const queryBuilder: SelectQueryBuilder<Product> = this.productRepository
      .createQueryBuilder("product")
      .leftJoinAndSelect("product.brand", "brand")
      .leftJoinAndSelect("product.categories", "categories");

    if (search) {
      queryBuilder.andWhere(
        "(product.name LIKE :search OR product.description LIKE :search OR product.sku LIKE :search)",
        { search: `%${search}%` },
      );
    }

    if (categoryId) {
      queryBuilder.andWhere("categories.id = :categoryId", { categoryId });
    }

    if (brandId) {
      queryBuilder.andWhere("product.brandId = :brandId", { brandId });
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

    queryBuilder.orderBy(`product.${sortBy}`, sortOrder);

    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();

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
    return this.findAllProducts({ ...query, categoryId });
  }

  async findProductsByBrand(brandId: number, query: GetProductsQueryDto) {
    return this.findAllProducts({ ...query, brandId });
  }

  // Brand methods
  async createBrand(createBrandDto: CreateBrandDto): Promise<Brand> {
    const brand = this.brandRepository.create(createBrandDto);
    return this.brandRepository.save(brand);
  }

  async findAllBrands(): Promise<Brand[]> {
    return this.brandRepository.find({
      relations: ["products"],
      order: { name: "ASC" },
    });
  }

  async findBrandById(id: number): Promise<Brand> {
    const brand = await this.brandRepository.findOne({
      where: { id },
      relations: ["products"],
    });
    if (!brand) {
      throw new NotFoundException("Brand not found");
    }
    return brand;
  }

  // Category methods
  async createCategory(
    createCategoryDto: CreateCategoryDto,
  ): Promise<Category> {
    const category = this.categoryRepository.create(createCategoryDto);
    return this.categoryRepository.save(category);
  }

  async findAllCategories(): Promise<Category[]> {
    return this.categoryRepository.find({
      relations: ["products"],
      order: { name: "ASC" },
    });
  }

  async findCategoryById(id: number): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { id },
      relations: ["products"],
    });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }
}
