import { Injectable, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { Inject } from "@nestjs/common";
import { firstValueFrom, timeout, catchError } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { CART_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { PRODUCT_MESSAGE } from "libs/constant/response-message.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { AddToCartDto } from "./dto/cart.dto";
import { ProductResponse, ProductSkuResponse } from "./cart.types";

@Injectable()
export class CartGatewayService {
  private readonly logger = new Logger(CartGatewayService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.ORDERS_SERVICE)
    private readonly ordersClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE)
    private readonly productClient: ClientProxy,
  ) {}

  async addItem(userId: number, dto: AddToCartDto): Promise<unknown> {
    let skuTierIdx: string | null = null;

    if (dto.skuId) {
      const sku = await firstValueFrom(
        this.productClient
          .send<ProductSkuResponse>(
            PRODUCT_MESSAGE_PATTERNS.SKU_FIND_BY_ID,
            dto.skuId,
          )
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );

      if (Number(sku.productId) !== dto.productId) {
        MicroserviceErrorHandler.handleError(
          {
            statusCode: 400,
            message: PRODUCT_MESSAGE.SKU_NOT_OF_SPECIFIED_PRODUCT,
          },
          "add to cart",
          "Product Service",
        );
      }

      skuTierIdx = Array.isArray(sku.tierIdx)
        ? JSON.stringify(sku.tierIdx)
        : sku.tierIdx;
    } else {
      const product = await firstValueFrom(
        this.productClient
          .send<ProductResponse>(
            PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID,
            dto.productId,
          )
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );

      if (product.price === null) {
        MicroserviceErrorHandler.handleError(
          {
            statusCode: 400,
            message: PRODUCT_MESSAGE.BASE_PRICE_REQUIRES_SKU,
          },
          "add to cart",
          "Product Service",
        );
      }
    }

    try {
      return await firstValueFrom(
        this.ordersClient
          .send(CART_MESSAGE_PATTERN.CART_ADD_ITEM, {
            userId,
            productId: dto.productId,
            skuId: dto.skuId ?? null,
            skuTierIdx,
            quantity: dto.quantity,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "add to cart",
        "Orders Service",
      );
    }
  }

  async getCart(userId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient.send(CART_MESSAGE_PATTERN.CART_GET, { userId }).pipe(
          timeout(10000),
          catchError((err: unknown) => {
            throw err;
          }),
        ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, "get cart", "Orders Service");
    }
  }

  async updateItem(
    userId: number,
    cartItemId: number,
    quantity: number,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.ordersClient
          .send(CART_MESSAGE_PATTERN.CART_UPDATE_ITEM, {
            userId,
            cartItemId,
            quantity,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "update cart item",
        "Orders Service",
      );
    }
  }

  async removeItem(userId: number, cartItemId: number): Promise<void> {
    try {
      await firstValueFrom(
        this.ordersClient
          .send(CART_MESSAGE_PATTERN.CART_REMOVE_ITEM, { userId, cartItemId })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "remove cart item",
        "Orders Service",
      );
    }
  }

  async clearCart(userId: number): Promise<void> {
    try {
      await firstValueFrom(
        this.ordersClient
          .send(CART_MESSAGE_PATTERN.CART_CLEAR, { userId })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "clear cart",
        "Orders Service",
      );
    }
  }
}
