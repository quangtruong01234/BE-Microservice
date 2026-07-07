import {
  Controller,
  Logger,
  NotFoundException,
  UseFilters,
} from "@nestjs/common";
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from "@nestjs/microservices";
import { ProductService } from "./product.service";
import {
  HttpToRpcExceptionFilter,
  PaginatedResponse,
  RmqService,
} from "@app/common";
import { ProductReview } from "./entity/product-review.entity";
import { EVENT } from "@app/common/constants/event";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { CreateBrandDto } from "./dto/create-brand.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { GetProductsQueryDto } from "./dto/get-products-query.dto";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";

@UseFilters(HttpToRpcExceptionFilter)
@Controller()
export class ProductController {
  private readonly logger = new Logger(ProductController.name);

  constructor(
    private readonly productService: ProductService,
    private readonly rmqService: RmqService,
  ) {}

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

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS)
  async findProductsByIds(@Payload() ids: number[]) {
    return this.productService.findProductsByIds(ids);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_SKU)
  async findProductBySku(@Payload() sku: string) {
    return this.productService.findProductBySku(sku);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_UPDATE)
  async updateProduct(
    @Payload() data: { id: number; updateProductDto: UpdateProductDto },
  ) {
    const { id, updateProductDto } = data;
    return this.productService.updateProduct(id, updateProductDto);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_DELETE)
  async deleteProduct(@Payload() id: number) {
    return this.productService.deleteProduct(id);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_CATEGORY)
  async findProductsByCategory(
    @Payload() data: { categoryId: number; query: GetProductsQueryDto },
  ) {
    const { categoryId, query } = data;
    return this.productService.findProductsByCategory(categoryId, query);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.GET_PRODUCT_IDS_BY_SELLER)
  async handleGetProductIdsBySeller(
    @Payload() sellerId: number,
  ): Promise<number[]> {
    return this.productService.getProductIdsBySeller(sellerId);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_BRAND)
  async findProductsByBrand(
    @Payload() data: { brandId: number; query: GetProductsQueryDto },
  ) {
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
  async createBrand(
    @Payload() payload: CreateBrandDto & { submittedBy: number },
  ) {
    const { submittedBy, ...dto } = payload;
    return this.productService.createBrand(dto, submittedBy);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.BRAND_FIND_ALL)
  async findAllBrands(
    @Payload() payload: { status?: "pending" | "active" | "rejected" },
  ) {
    return this.productService.findAllBrands(payload?.status);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.BRAND_FIND_BY_ID)
  async findBrandById(@Payload() id: number) {
    return this.productService.findBrandById(id);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.BRAND_REVIEW)
  async reviewBrand(
    @Payload()
    payload: {
      id: number;
      action: "approve" | "reject";
      note?: string;
    },
  ) {
    return this.productService.reviewBrand(
      payload.id,
      payload.action,
      payload.note,
    );
  }

  // ============================================================================
  // CATEGORY MESSAGE PATTERNS
  // ============================================================================

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.CATEGORY_CREATE)
  async createCategory(
    @Payload() payload: CreateCategoryDto & { submittedBy: number },
  ) {
    const { submittedBy, ...dto } = payload;
    return this.productService.createCategory(dto, submittedBy);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.CATEGORY_FIND_ALL)
  async findAllCategories(
    @Payload() payload: { status?: "pending" | "active" | "rejected" },
  ) {
    return this.productService.findAllCategories(payload?.status);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.CATEGORY_FIND_BY_ID)
  async findCategoryById(@Payload() id: number) {
    return this.productService.findCategoryById(id);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.CATEGORY_REVIEW)
  async reviewCategory(
    @Payload()
    payload: {
      id: number;
      action: "approve" | "reject";
      note?: string;
    },
  ) {
    return this.productService.reviewCategory(
      payload.id,
      payload.action,
      payload.note,
    );
  }

  // ============================================================================
  // SKU MESSAGE PATTERNS
  // ============================================================================

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.SKU_FIND_BY_PRODUCT)
  async findSkusByProduct(@Payload() productId: number) {
    return this.productService.findSkusByProduct(productId);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.SKU_FIND_BY_ID)
  async findSkuById(@Payload() id: number) {
    return this.productService.findSkuById(id);
  }

  // ============================================================================
  // REVIEW MESSAGE PATTERNS
  // ============================================================================

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.REVIEW_CREATE)
  async createReview(
    @Payload()
    data: {
      userId: number;
      productId: number;
      rating: number;
      comment?: string;
    },
  ): Promise<ProductReview> {
    return this.productService.createReview(data);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.REVIEW_DELETE)
  async deleteReview(
    @Payload() data: { reviewId: number; userId: number },
  ): Promise<null> {
    await this.productService.deleteReview(data.reviewId, data.userId);
    return null;
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.REVIEW_FIND_BY_PRODUCT)
  async findReviewsByProduct(
    @Payload() data: { productId: number; page: number; limit: number },
  ): Promise<PaginatedResponse<ProductReview>> {
    return this.productService.findReviewsByProduct(
      data.productId,
      data.page,
      data.limit,
    );
  }

  // ============================================================================
  // WISHLIST MESSAGE PATTERNS
  // ============================================================================

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.WISHLIST_ADD)
  async addWishlistItem(
    @Payload() data: { userId: number; productId: number },
  ): Promise<{ productId: number; isWishlisted: boolean; createdAt: Date }> {
    return this.productService.addWishlistItem(data.userId, data.productId);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.WISHLIST_REMOVE)
  async removeWishlistItem(
    @Payload() data: { userId: number; productId: number },
  ): Promise<null> {
    return this.productService.removeWishlistItem(data.userId, data.productId);
  }

  @MessagePattern(PRODUCT_MESSAGE_PATTERNS.WISHLIST_LIST)
  async findWishlistByUser(
    @Payload() data: { userId: number; page?: number; limit?: number },
  ): Promise<PaginatedResponse<unknown>> {
    return this.productService.findWishlistByUser(
      data.userId,
      data.page,
      data.limit,
    );
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  @EventPattern(EVENT.INVENTORY_STOCK_CHANGED_EVENT)
  async handleInventoryStockChanged(
    @Payload() data: { productId: number; availableStock: number },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const { productId, availableStock } = data;
    this.logger.log(
      `[PRODUCT] inventory.stock_changed received: product ${productId}, availableStock ${availableStock}`,
    );
    try {
      await this.productService.updateStockQuantity(productId, availableStock);
      this.rmqService.ack(context);
    } catch (err: unknown) {
      this.logger.error(
        `[PRODUCT] Failed to update stock for product ${productId}`,
        err instanceof Error ? err.stack : String(err),
      );
      const channel = context.getChannelRef() as {
        nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      const originalMsg = context.getMessage();
      if (err instanceof NotFoundException) {
        channel.nack(originalMsg, false, false);
      } else {
        channel.nack(originalMsg, false, true);
      }
    }
  }
}
