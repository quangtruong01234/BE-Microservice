import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateBrandDto } from './dto/create-brand.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { GetProductsQueryDto } from './dto/get-products-query.dto';
import { PRODUCT_MESSAGE_PATTERNS } from 'libs/constant/message-pattern-product.constant';

@Controller()
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  // ============================================================================
  // PRODUCT MESSAGE PATTERNS
  // ============================================================================

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_CREATE)
  async createProduct(@Payload() createProductDto: CreateProductDto) {
    return this.productService.createProduct(createProductDto);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_ALL)
  async findAllProducts(@Payload() query: GetProductsQueryDto) {
    return this.productService.findAllProducts(query);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID)
  async findProductById(@Payload() id: number) {
    return this.productService.findProductById(id);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_SKU)
  async findProductBySku(@Payload() sku: string) {
    return this.productService.findProductBySku(sku);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_UPDATE)
  async updateProduct(@Payload() data: { id: number; updateProductDto: UpdateProductDto }) {
    const { id, updateProductDto } = data;
    return this.productService.updateProduct(id, updateProductDto);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_DELETE)
  async deleteProduct(@Payload() id: number) {
    return this.productService.deleteProduct(id);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_CATEGORY)
  async findProductsByCategory(@Payload() data: { categoryId: number; query: GetProductsQueryDto }) {
    const { categoryId, query } = data;
    return this.productService.findProductsByCategory(categoryId, query);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_BRAND)
  async findProductsByBrand(@Payload() data: { brandId: number; query: GetProductsQueryDto }) {
    const { brandId, query } = data;
    return this.productService.findProductsByBrand(brandId, query);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_SEARCH)
  async searchProducts(@Payload() query: GetProductsQueryDto) {
    return this.productService.findAllProducts(query);
  }

  // ============================================================================
  // BRAND MESSAGE PATTERNS
  // ============================================================================

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.BRAND_CREATE)
  async createBrand(@Payload() createBrandDto: CreateBrandDto) {
    return this.productService.createBrand(createBrandDto);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.BRAND_FIND_ALL)
  async findAllBrands() {
    return this.productService.findAllBrands();
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.BRAND_FIND_BY_ID)
  async findBrandById(@Payload() id: number) {
    return this.productService.findBrandById(id);
  }

  // ============================================================================
  // CATEGORY MESSAGE PATTERNS
  // ============================================================================

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.CATEGORY_CREATE)
  async createCategory(@Payload() createCategoryDto: CreateCategoryDto) {
    return this.productService.createCategory(createCategoryDto);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.CATEGORY_FIND_ALL)
  async findAllCategories() {
    return this.productService.findAllCategories();
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.CATEGORY_FIND_BY_ID)
  async findCategoryById(@Payload() id: number) {
    return this.productService.findCategoryById(id);
  }
}