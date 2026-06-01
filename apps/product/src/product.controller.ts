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
import { HttpToRpcExceptionFilter, RmqService } from "@app/common";
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
