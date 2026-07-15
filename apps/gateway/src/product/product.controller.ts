import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from "@nestjs/common";
import { Request } from "express";
import { ProductService } from "./product.service";
import {
  CreateProductDto,
  UpdateProductDto,
  GetProductsQueryDto,
  CreateBrandDto,
  ReviewBrandDto,
  CreateCategoryDto,
  ReviewCategoryDto,
  WishlistQueryDto,
  GetProductsWithInventoryDto,
  PriceSuggestionQueryDto,
  ProductRiskQueryDto,
} from "./dto";
import { CreateReviewDto, ReviewQueryDto } from "./dto/review.dto";
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
import { PriceSuggestion, ProductRiskSummary } from "./product.types";

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
  async createProduct(@Body() dto: CreateProductDto, @Req() req: Request) {
    const userId = (req.user as { id: number }).id;
    return await this.productService.createProduct(dto, userId);
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

  @Get("price-suggestion")
  @ApiOperation({ summary: "Suggest a product price from catalog data" })
  @ApiResponse({ status: 200, description: "Price suggestion calculated." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getPriceSuggestion(
    @Query(ValidationPipe) query: PriceSuggestionQueryDto,
  ): Promise<PriceSuggestion> {
    return await this.productService.getPriceSuggestion(query);
  }

  @Get("admin/risk")
  @CheckPermission("product", "read:any")
  @ApiOperation({
    summary: "List products by advisory risk score (admin only)",
  })
  @ApiResponse({ status: 200, description: "Product risk queue retrieved." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  async getProductRisks(
    @Query(ValidationPipe) query: ProductRiskQueryDto,
  ): Promise<unknown> {
    return await this.productService.getProductRisks(query);
  }

  @Post("admin/risk/:id/rescore")
  @CheckPermission("product", "update:any")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Recompute one product risk score (admin only)" })
  @ApiParam({ name: "id", description: "Product ID", type: Number })
  @ApiResponse({ status: 200, description: "Product risk score recomputed." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Product not found." })
  async rescoreProductRisk(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<ProductRiskSummary> {
    return await this.productService.rescoreProductRisk(id);
  }

  @Get("search")
  @Public()
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
  @Public()
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
  @Public()
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
  @Public()
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
  @Public()
  @ApiOperation({ summary: "Get all active brands" })
  @ApiResponse({ status: 200, description: "Brands retrieved successfully." })
  async getAllBrands() {
    return await this.productService.getAllBrands();
  }

  @Get("brands/pending")
  @CheckPermission("brand", "read:any")
  @ApiOperation({ summary: "Get all pending brands (admin only)" })
  @ApiResponse({
    status: 200,
    description: "Pending brands retrieved successfully.",
  })
  @ApiResponse({ status: 403, description: "Forbidden." })
  async getPendingBrands() {
    return await this.productService.getPendingBrands();
  }

  @Post("brands")
  @ApiOperation({ summary: "Create new brand (submitted for review)" })
  @ApiBody({ type: CreateBrandDto })
  @ApiResponse({ status: 201, description: "Brand submitted for review." })
  @ApiResponse({
    status: 400,
    description: "Bad Request - Invalid input data.",
  })
  @ApiResponse({
    status: 409,
    description: "Conflict - brand already exists or is pending review.",
  })
  async createBrand(@Body() dto: CreateBrandDto, @Req() req: Request) {
    const userId = (req.user as { id: number }).id;
    return await this.productService.createBrand(dto, userId);
  }

  @Patch("brands/:id/review")
  @CheckPermission("brand", "update:any")
  @ApiOperation({ summary: "Approve or reject a brand (admin only)" })
  @ApiParam({ name: "id", description: "Brand ID", type: Number })
  @ApiBody({ type: ReviewBrandDto })
  @ApiResponse({ status: 200, description: "Brand reviewed successfully." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Brand not found." })
  async reviewBrand(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReviewBrandDto,
  ) {
    return await this.productService.reviewBrand(id, dto);
  }

  @Get("brands/:id")
  @Public()
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
  @Public()
  @ApiOperation({ summary: "Get all active categories" })
  @ApiResponse({
    status: 200,
    description: "Categories retrieved successfully.",
  })
  async getAllCategories() {
    return await this.productService.getAllCategories();
  }

  @Get("categories/pending")
  @CheckPermission("category", "read:any")
  @ApiOperation({ summary: "Get all pending categories (admin only)" })
  @ApiResponse({
    status: 200,
    description: "Pending categories retrieved successfully.",
  })
  @ApiResponse({ status: 403, description: "Forbidden." })
  async getPendingCategories() {
    return await this.productService.getPendingCategories();
  }

  @Post("categories")
  @ApiOperation({ summary: "Create new category (submitted for review)" })
  @ApiBody({ type: CreateCategoryDto })
  @ApiResponse({ status: 201, description: "Category submitted for review." })
  @ApiResponse({
    status: 400,
    description: "Bad Request - Invalid input data.",
  })
  @ApiResponse({
    status: 409,
    description: "Conflict - category already exists or is pending review.",
  })
  async createCategory(@Body() dto: CreateCategoryDto, @Req() req: Request) {
    const userId = (req.user as { id: number }).id;
    return await this.productService.createCategory(dto, userId);
  }

  @Patch("categories/:id/review")
  @CheckPermission("category", "update:any")
  @ApiOperation({ summary: "Approve or reject a category (admin only)" })
  @ApiParam({ name: "id", description: "Category ID", type: Number })
  @ApiBody({ type: ReviewCategoryDto })
  @ApiResponse({ status: 200, description: "Category reviewed successfully." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Category not found." })
  async reviewCategory(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReviewCategoryDto,
  ) {
    return await this.productService.reviewCategory(id, dto);
  }

  @Get("categories/:id")
  @Public()
  @ApiOperation({ summary: "Get category by ID" })
  @ApiParam({ name: "id", description: "Category ID", type: Number })
  @ApiResponse({ status: 200, description: "Category retrieved successfully." })
  @ApiResponse({ status: 404, description: "Category not found." })
  async getCategoryById(@Param("id", ParseIntPipe) id: number) {
    return await this.productService.getCategoryById(id);
  }

  // ============================================================================
  // WISHLIST ENDPOINTS
  // ============================================================================

  @Get("wishlist")
  @ApiOperation({ summary: "Get current user's wishlist products" })
  @ApiResponse({
    status: 200,
    description: "Wishlist products retrieved successfully.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getWishlist(
    @Req() req: Request,
    @Query(ValidationPipe) query: WishlistQueryDto,
  ): Promise<unknown> {
    const userId = (req.user as { id: number }).id;
    return await this.productService.getWishlist(userId, query);
  }

  @Post("wishlist/:productId")
  @ApiOperation({ summary: "Add a product to the current user's wishlist" })
  @ApiParam({ name: "productId", description: "Product ID", type: Number })
  @ApiResponse({ status: 201, description: "Product added to wishlist." })
  @ApiResponse({ status: 404, description: "Product not found." })
  async addWishlistItem(
    @Param("productId", ParseIntPipe) productId: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const userId = (req.user as { id: number }).id;
    return await this.productService.addWishlistItem(productId, userId);
  }

  @Delete("wishlist/:productId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Remove a product from the current user's wishlist",
  })
  @ApiParam({ name: "productId", description: "Product ID", type: Number })
  @ApiResponse({ status: 204, description: "Product removed from wishlist." })
  async removeWishlistItem(
    @Param("productId", ParseIntPipe) productId: number,
    @Req() req: Request,
  ): Promise<void> {
    const userId = (req.user as { id: number }).id;
    await this.productService.removeWishlistItem(productId, userId);
  }

  // ============================================================================
  // REVIEW ENDPOINTS
  // ============================================================================

  @Get(":id/reviews")
  @Public()
  @ApiOperation({ summary: "Get reviews for a product (paginated)" })
  @ApiParam({ name: "id", description: "Product ID", type: Number })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  async getProductReviews(
    @Param("id", ParseIntPipe) id: number,
    @Query() query: ReviewQueryDto,
  ) {
    return this.productService.getProductReviews(
      id,
      query.page ?? 1,
      query.limit ?? 10,
    );
  }

  @Post(":id/reviews")
  @ApiOperation({ summary: "Create a review for a purchased product" })
  @ApiParam({ name: "id", description: "Product ID", type: Number })
  @ApiBody({ type: CreateReviewDto })
  @ApiResponse({ status: 201, description: "Review created successfully." })
  @ApiResponse({
    status: 403,
    description: "Forbidden - product not in any completed order.",
  })
  @ApiResponse({ status: 409, description: "Conflict - already reviewed." })
  async createProductReview(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: CreateReviewDto,
    @Req() req: Request,
  ) {
    const userId = (req as unknown as { user: { id: number } }).user.id;
    return this.productService.createProductReview(id, userId, dto);
  }

  @Delete("reviews/:reviewId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a review (owner only)" })
  @ApiParam({ name: "reviewId", description: "Review ID", type: Number })
  @ApiResponse({ status: 204, description: "Review deleted successfully." })
  @ApiResponse({ status: 403, description: "Forbidden - not your review." })
  @ApiResponse({ status: 404, description: "Review not found." })
  async deleteProductReview(
    @Param("reviewId", ParseIntPipe) reviewId: number,
    @Req() req: Request,
  ) {
    const userId = (req as unknown as { user: { id: number } }).user.id;
    await this.productService.deleteProductReview(reviewId, userId);
  }

  // ============================================================================
  // SKU ENDPOINTS
  // ============================================================================

  @Get(":id/skus")
  @Public()
  @ApiOperation({ summary: "Get SKUs for a product" })
  @ApiParam({ name: "id", description: "Product ID", type: Number })
  @ApiResponse({ status: 200, description: "SKUs retrieved successfully." })
  @ApiResponse({ status: 404, description: "Product not found." })
  async getSkusByProduct(@Param("id", ParseIntPipe) id: number) {
    return await this.productService.getSkusByProduct(id);
  }

  @Get(":id")
  @Public()
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
  @ApiResponse({
    status: 403,
    description: "Forbidden - not the product owner.",
  })
  async updateProduct(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
    @Req() req: Request,
  ) {
    return await this.productService.updateProduct(
      id,
      dto,
      req.user?.id ?? 0,
      req.user?.role ?? "user",
    );
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete product" })
  @ApiParam({ name: "id", description: "Product ID", type: Number })
  @ApiResponse({ status: 204, description: "Product deleted successfully." })
  @ApiResponse({ status: 404, description: "Product not found." })
  @ApiResponse({
    status: 403,
    description: "Forbidden - not the product owner.",
  })
  async deleteProduct(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return await this.productService.deleteProduct(
      id,
      req.user?.id ?? 0,
      req.user?.role ?? "user",
    );
  }

  // ============================================================================
  // AGGREGATOR ENDPOINTS - PRODUCT + INVENTORY
  // ============================================================================

  @Get("shop/stats")
  @ApiOperation({
    summary: "Get shop-wide inventory stats for the current seller",
  })
  @ApiResponse({
    status: 200,
    description: "Shop stats retrieved successfully.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getShopStats(@Req() req: Request) {
    const sellerId = req.user?.id ?? 0;
    return await this.productService.getShopStats(sellerId);
  }

  @Get("with-inventory/all")
  @Public()
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
  @Public()
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
  @Public()
  @ApiOperation({
    summary: "Get multiple products with inventory by product IDs",
  })
  @ApiBody({ type: GetProductsWithInventoryDto })
  @ApiResponse({
    status: 200,
    description: "Products with inventory retrieved successfully.",
  })
  @ApiResponse({
    status: 400,
    description: "Bad Request - Invalid product IDs.",
  })
  async getProductsWithInventory(@Body() body: GetProductsWithInventoryDto) {
    return await this.productService.getProductsWithInventory([
      ...new Set(body.productIds),
    ]);
  }

  @Get(":id/stock-check")
  @Public()
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
