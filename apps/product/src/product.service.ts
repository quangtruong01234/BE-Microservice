import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, SelectQueryBuilder } from "typeorm";
import { Product } from "./entity/product.entity";
import { Brand } from "./entity/brand.entity";
import { Category } from "./entity/category.entity";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { CreateBrandDto } from "./dto/create-brand.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { GetProductsQueryDto } from "./dto/get-products-query.dto";

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) {}

  // Product methods
  async createProduct(createProductDto: CreateProductDto): Promise<Product> {
    // Check if SKU already exists
    const existingProduct = await this.productRepository.findOne({
      where: { sku: createProductDto.sku },
    });
    if (existingProduct) {
      throw new ConflictException("Product with this SKU already exists");
    }

    // Verify category exists
    const category = await this.categoryRepository.findOne({
      where: { id: createProductDto.categoryId },
    });
    if (!category) {
      throw new NotFoundException("Category not found");
    }

    // Verify brand exists (if provided)
    if (createProductDto.brandId) {
      const brand = await this.brandRepository.findOne({
        where: { id: createProductDto.brandId },
      });
      if (!brand) {
        throw new NotFoundException("Brand not found");
      }
    }

    const product = this.productRepository.create(createProductDto);
    return this.productRepository.save(product);
  }

  async findAllProducts(query: GetProductsQueryDto) {
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
      .leftJoinAndSelect("product.category", "category");

    // Apply filters
    if (search) {
      queryBuilder.andWhere(
        "(product.name LIKE :search OR product.description LIKE :search OR product.sku LIKE :search)",
        { search: `%${search}%` },
      );
    }

    if (categoryId) {
      queryBuilder.andWhere("product.categoryId = :categoryId", { categoryId });
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

    // Social features filters
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

    // Apply sorting
    queryBuilder.orderBy(`product.${sortBy}`, sortOrder);

    // Apply pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findProductById(id: number): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ["brand", "category"],
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    return product;
  }

  async findProductBySku(sku: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { sku },
      relations: ["brand", "category"],
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

    // Check SKU uniqueness if it's being updated
    if (updateProductDto.sku && updateProductDto.sku !== product.sku) {
      const existingProduct = await this.productRepository.findOne({
        where: { sku: updateProductDto.sku },
      });
      if (existingProduct) {
        throw new ConflictException("Product with this SKU already exists");
      }
    }

    // Verify category exists if it's being updated
    if (updateProductDto.categoryId) {
      const category = await this.categoryRepository.findOne({
        where: { id: updateProductDto.categoryId },
      });
      if (!category) {
        throw new NotFoundException("Category not found");
      }
    }

    // Verify brand exists if it's being updated
    if (updateProductDto.brandId) {
      const brand = await this.brandRepository.findOne({
        where: { id: updateProductDto.brandId },
      });
      if (!brand) {
        throw new NotFoundException("Brand not found");
      }
    }

    Object.assign(product, updateProductDto);
    return this.productRepository.save(product);
  }

  async deleteProduct(id: number): Promise<void> {
    const product = await this.findProductById(id);
    await this.productRepository.remove(product);
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
