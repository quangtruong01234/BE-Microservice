import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from "@nestjs/common";
import { ProductService } from "./product.service";
import {
  CreateProductDto,
  UpdateProductDto,
  GetProductsQueryDto,
  CreateBrandDto,
  CreateCategoryDto,
} from "./dto/product.dto";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { CheckPermission } from "../common/decorators/check-permission.decorator";
import { Public } from "../common/decorators/public.decorator";

@ApiTags("Products")
@Controller("products")
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  // ============================================================================
  // PRODUCT ENDPOINTS
  // ============================================================================

  @Post()
  @CheckPermission("product", "create:own")
  @ApiOperation({ summary: "Create new product" })
  @ApiBody({ type: CreateProductDto })
  @ApiResponse({ status: 201, description: "Product created successfully." })
  @ApiResponse({
    status: 400,
    description: "Bad Request - Invalid input data.",
  })
  @ApiResponse({ status: 409, description: "Conflict - SKU already exists." })
  async createProduct(@Body() dto: CreateProductDto) {
    return await this.productService.createProduct(dto);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: "Get all products with filtering and pagination" })
  @ApiResponse({ status: 200, description: "Products retrieved successfully." })
  @ApiResponse({
    status: 400,
    description: "Bad Request - Invalid query parameters.",
  })
  async getAllProducts(@Query(ValidationPipe) query: GetProductsQueryDto) {
    return await this.productService.getAllProducts(query);
  }

  @Get("search")
  @ApiOperation({ summary: "Search products by keyword" })
  @ApiResponse({
    status: 200,
    description: "Search results retrieved successfully.",
  })
  @ApiResponse({
    status: 400,
    description: "Bad Request - Missing search query.",
  })
  async searchProducts(@Query(ValidationPipe) query: GetProductsQueryDto) {
    return await this.productService.searchProducts(query);
  }

  @Get("category/:categoryId")
  @ApiOperation({ summary: "Get products by category" })
  @ApiParam({ name: "categoryId", description: "Category ID", type: Number })
  @ApiResponse({
    status: 200,
    description: "Products by category retrieved successfully.",
  })
  @ApiResponse({ status: 404, description: "Category not found." })
  async getProductsByCategory(
    @Param("categoryId", ParseIntPipe) categoryId: number,
    @Query(ValidationPipe) query: GetProductsQueryDto,
  ) {
    return await this.productService.getProductsByCategory(categoryId, query);
  }

  @Get("brand/:brandId")
  @ApiOperation({ summary: "Get products by brand" })
  @ApiParam({ name: "brandId", description: "Brand ID", type: Number })
  @ApiResponse({
    status: 200,
    description: "Products by brand retrieved successfully.",
  })
  @ApiResponse({ status: 404, description: "Brand not found." })
  async getProductsByBrand(
    @Param("brandId", ParseIntPipe) brandId: number,
    @Query(ValidationPipe) query: GetProductsQueryDto,
  ) {
    return await this.productService.getProductsByBrand(brandId, query);
  }

  @Get("sku/:sku")
  @ApiOperation({ summary: "Get product by SKU" })
  @ApiParam({ name: "sku", description: "Product SKU", type: String })
  @ApiResponse({ status: 200, description: "Product retrieved successfully." })
  @ApiResponse({ status: 404, description: "Product not found." })
  async getProductBySku(@Param("sku") sku: string) {
    return await this.productService.getProductBySku(sku);
  }

  // ============================================================================
  // BRAND ENDPOINTS
  // ============================================================================

  @Get("brands")
  @ApiOperation({ summary: "Get all brands" })
  @ApiResponse({ status: 200, description: "Brands retrieved successfully." })
  async getAllBrands() {
    return await this.productService.getAllBrands();
  }

  @Post("brands")
  @ApiOperation({ summary: "Create new brand" })
  @ApiResponse({ status: 201, description: "Brand created successfully." })
  @ApiResponse({
    status: 400,
    description: "Bad Request - Invalid input data.",
  })
  async createBrand(@Body() dto: CreateBrandDto) {
    return await this.productService.createBrand(dto);
  }

  @Get("brands/:id")
  @ApiOperation({ summary: "Get brand by ID" })
  @ApiParam({ name: "id", description: "Brand ID", type: Number })
  @ApiResponse({ status: 200, description: "Brand retrieved successfully." })
  @ApiResponse({ status: 404, description: "Brand not found." })
  async getBrandById(@Param("id", ParseIntPipe) id: number) {
    return await this.productService.getBrandById(id);
  }

  // ============================================================================
  // CATEGORY ENDPOINTS
  // ============================================================================

  @Get("categories")
  @ApiOperation({ summary: "Get all categories" })
  @ApiResponse({
    status: 200,
    description: "Categories retrieved successfully.",
  })
  async getAllCategories() {
    console.log("Fetching all categories");
    return await this.productService.getAllCategories();
  }

  @Post("categories")
  @ApiOperation({ summary: "Create new category" })
  @ApiResponse({ status: 201, description: "Category created successfully." })
  @ApiResponse({
    status: 400,
    description: "Bad Request - Invalid input data.",
  })
  async createCategory(@Body() dto: CreateCategoryDto) {
    return await this.productService.createCategory(dto);
  }

  @Get("categories/:id")
  @ApiOperation({ summary: "Get category by ID" })
  @ApiParam({ name: "id", description: "Category ID", type: Number })
  @ApiResponse({ status: 200, description: "Category retrieved successfully." })
  @ApiResponse({ status: 404, description: "Category not found." })
  async getCategoryById(@Param("id", ParseIntPipe) id: number) {
    return await this.productService.getCategoryById(id);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get product by ID" })
  @ApiParam({ name: "id", description: "Product ID", type: Number })
  @ApiResponse({ status: 200, description: "Product retrieved successfully." })
  @ApiResponse({ status: 404, description: "Product not found." })
  async getProductById(@Param("id", ParseIntPipe) id: number) {
    return await this.productService.getProductById(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update product" })
  @ApiParam({ name: "id", description: "Product ID", type: Number })
  @ApiBody({ type: UpdateProductDto })
  @ApiResponse({ status: 200, description: "Product updated successfully." })
  @ApiResponse({
    status: 400,
    description: "Bad Request - Invalid input data.",
  })
  @ApiResponse({ status: 404, description: "Product not found." })
  @ApiResponse({ status: 409, description: "Conflict - SKU already exists." })
  async updateProduct(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return await this.productService.updateProduct(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete product" })
  @ApiParam({ name: "id", description: "Product ID", type: Number })
  @ApiResponse({ status: 204, description: "Product deleted successfully." })
  @ApiResponse({ status: 404, description: "Product not found." })
  async deleteProduct(@Param("id", ParseIntPipe) id: number) {
    return await this.productService.deleteProduct(id);
  }

  // ============================================================================
  // AGGREGATOR ENDPOINTS - PRODUCT + INVENTORY
  // ============================================================================

  @Get("with-inventory/all")
  @ApiOperation({ summary: "Get all products with inventory information" })
  @ApiResponse({
    status: 200,
    description: "Products with inventory retrieved successfully.",
  })
  async getAllProductsWithInventory(
    @Query(ValidationPipe) query: GetProductsQueryDto,
  ) {
    return await this.productService.getAllProductsWithInventory(query);
  }

  @Get(":id/with-inventory")
  @ApiOperation({ summary: "Get product with inventory by product ID" })
  @ApiParam({ name: "id", description: "Product ID", type: Number })
  @ApiResponse({
    status: 200,
    description: "Product with inventory retrieved successfully.",
  })
  @ApiResponse({ status: 404, description: "Product not found." })
  async getProductWithInventoryById(@Param("id", ParseIntPipe) id: number) {
    return await this.productService.getProductWithInventoryById(id);
  }

  @Post("with-inventory/multiple")
  @ApiOperation({
    summary: "Get multiple products with inventory by product IDs",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        productIds: {
          type: "array",
          items: { type: "number" },
          description: "Array of product IDs",
        },
      },
      required: ["productIds"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Products with inventory retrieved successfully.",
  })
  @ApiResponse({
    status: 400,
    description: "Bad Request - Invalid product IDs.",
  })
  async getProductsWithInventory(@Body() body: { productIds: number[] }) {
    return await this.productService.getProductsWithInventory(body.productIds);
  }

  @Get(":id/stock-check")
  @ApiOperation({ summary: "Check stock availability for a product" })
  @ApiParam({ name: "id", description: "Product ID", type: Number })
  @ApiQuery({
    name: "quantity",
    description: "Requested quantity",
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: "Stock check completed successfully.",
  })
  @ApiResponse({ status: 404, description: "Product not found." })
  async checkProductStock(
    @Param("id", ParseIntPipe) id: number,
    @Query("quantity", ParseIntPipe) quantity: number,
  ) {
    return await this.productService.checkProductStock(id, quantity);
  }
}
