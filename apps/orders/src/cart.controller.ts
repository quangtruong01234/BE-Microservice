import { Controller, Logger, UseFilters } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { HttpToRpcExceptionFilter } from "@app/common";
import { CartService } from "./cart.service";
import { CART_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";

@UseFilters(new HttpToRpcExceptionFilter())
@Controller()
export class CartController {
  private readonly logger = new Logger(CartController.name);

  constructor(private readonly cartService: CartService) {}

  @MessagePattern(CART_MESSAGE_PATTERN.CART_ADD_ITEM)
  async addItem(
    @Payload()
    payload: {
      userId: number;
      productId: number;
      skuId?: number | null;
      skuTierIdx?: string | null;
      quantity: number;
    },
  ) {
    this.logger.log(
      `[CART] addItem userId=${payload.userId} productId=${payload.productId}`,
    );
    return this.cartService.addItem(payload);
  }

  @MessagePattern(CART_MESSAGE_PATTERN.CART_GET)
  async getCart(@Payload() payload: { userId: number }) {
    return this.cartService.getCart(payload.userId);
  }

  @MessagePattern(CART_MESSAGE_PATTERN.CART_UPDATE_ITEM)
  async updateItem(
    @Payload()
    payload: {
      userId: number;
      cartItemId: number;
      quantity: number;
    },
  ): Promise<null> {
    await this.cartService.updateItem(
      payload.userId,
      payload.cartItemId,
      payload.quantity,
    );
    return null;
  }

  @MessagePattern(CART_MESSAGE_PATTERN.CART_REMOVE_ITEM)
  async removeItem(
    @Payload() payload: { userId: number; cartItemId: number },
  ): Promise<null> {
    await this.cartService.removeItem(payload.userId, payload.cartItemId);
    return null;
  }

  @MessagePattern(CART_MESSAGE_PATTERN.CART_CLEAR)
  async clearCart(@Payload() payload: { userId: number }): Promise<null> {
    await this.cartService.clearCart(payload.userId);
    return null;
  }
}
