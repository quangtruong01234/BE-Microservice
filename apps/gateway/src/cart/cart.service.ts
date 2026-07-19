import { Injectable, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { Inject } from "@nestjs/common";
import { firstValueFrom, timeout, catchError } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import {
  CART_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { PRODUCT_MESSAGE } from "libs/constant/response-message.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { AddToCartDto } from "./dto/cart.dto";
import { ProductResponse, ProductSkuResponse } from "./cart.types";
import { TCP_TIMEOUT_MS } from "libs/constant/tcp-timeout.constant";

@Injectable()
export class CartGatewayService {
  private readonly logger = new Logger(CartGatewayService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.ORDERS_SERVICE)
    private readonly ordersClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE)
    private readonly productClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
  ) {}

  private async exposeUserIds(value: unknown): Promise<unknown> {
    const userIds = new Set<number>();
    const collect = (nested: unknown): void => {
      if (Array.isArray(nested)) {
        nested.forEach(collect);
        return;
      }
      if (!nested || typeof nested !== "object") return;
      for (const [key, nestedValue] of Object.entries(
        nested as Record<string, unknown>,
      )) {
        if (
          key === "userId" &&
          nestedValue !== null &&
          Number.isFinite(Number(nestedValue))
        ) {
          userIds.add(Number(nestedValue));
        }
        collect(nestedValue);
      }
    };
    collect(value);
    if (userIds.size === 0) return value;
    const users = await firstValueFrom(
      this.userClient
        .send<
          Array<{ id: number; publicId?: string | null }>
        >({ cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS }, { userIds: [...userIds] })
        .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
    );
    const publicIdById = new Map(
      users.map((user) => [Number(user.id), user.publicId ?? null]),
    );
    const expose = (nested: unknown): unknown => {
      if (Array.isArray(nested)) return nested.map(expose);
      if (!nested || typeof nested !== "object") return nested;
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>).map(
          ([key, nestedValue]) => [
            key,
            key === "userId" && nestedValue !== null
              ? (publicIdById.get(Number(nestedValue)) ?? null)
              : expose(nestedValue),
          ],
        ),
      );
    };
    return expose(value);
  }

  private async exposeProductIds(value: unknown): Promise<unknown> {
    const productIds = new Set<number>();
    const collect = (nested: unknown): void => {
      if (Array.isArray(nested)) {
        nested.forEach(collect);
        return;
      }
      if (!nested || typeof nested !== "object") return;
      for (const [key, nestedValue] of Object.entries(
        nested as Record<string, unknown>,
      )) {
        if (key === "productId" && nestedValue !== null) {
          productIds.add(Number(nestedValue));
        }
        collect(nestedValue);
      }
    };
    collect(value);
    if (productIds.size === 0) return this.exposeUserIds(value);
    const products = await firstValueFrom(
      this.productClient
        .send<
          { id: number; publicId: string | null }[]
        >(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS, [...productIds])
        .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
    );
    const publicIdById = new Map(
      products.map((product) => [Number(product.id), product.publicId]),
    );
    const expose = (nested: unknown): unknown => {
      if (Array.isArray(nested)) return nested.map(expose);
      if (!nested || typeof nested !== "object") return nested;
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>).map(
          ([key, nestedValue]) => [
            key,
            key === "productId" && nestedValue !== null
              ? (publicIdById.get(Number(nestedValue)) ?? null)
              : expose(nestedValue),
          ],
        ),
      );
    };
    return this.exposeUserIds(expose(value));
  }

  async addItem(userId: number, dto: AddToCartDto): Promise<unknown> {
    let skuTierIdx: string | null = null;
    const product = await firstValueFrom(
      this.productClient
        .send<ProductResponse>(
          PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID,
          dto.productId,
        )
        .pipe(
          timeout(TCP_TIMEOUT_MS.WRITE),
          catchError((err: unknown) => {
            throw err;
          }),
        ),
    );
    const internalProductId = Number(product.id);

    if (dto.skuId) {
      const sku = await firstValueFrom(
        this.productClient
          .send<ProductSkuResponse>(
            PRODUCT_MESSAGE_PATTERNS.SKU_FIND_BY_ID,
            dto.skuId,
          )
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );

      if (Number(sku.productId) !== internalProductId) {
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
      const cart = await firstValueFrom(
        this.ordersClient
          .send<unknown>(CART_MESSAGE_PATTERN.CART_ADD_ITEM, {
            userId,
            productId: internalProductId,
            skuId: dto.skuId ?? null,
            skuTierIdx,
            quantity: dto.quantity,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
      return this.exposeProductIds(cart);
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
      const cart = await firstValueFrom(
        this.ordersClient
          .send<unknown>(CART_MESSAGE_PATTERN.CART_GET, { userId })
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
      return this.exposeProductIds(cart);
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
            timeout(TCP_TIMEOUT_MS.WRITE),
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
            timeout(TCP_TIMEOUT_MS.WRITE),
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
            timeout(TCP_TIMEOUT_MS.WRITE),
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
