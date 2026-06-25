import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { CachedService } from "@app/cached";
import { firstValueFrom, timeout, catchError } from "rxjs";
import {
  ORDER_MESSAGE_PATTERN,
  PAYMENT_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { PaymentMethod } from "@app/common";
import { CreateOrderDto } from "./dto/create-order.dto";
import { SellerOrdersQueryDto } from "./dto/seller-orders-query.dto";
import { ShippingFeeDto } from "./dto/shipping-fee.dto";

interface OrderResponse {
  id: number;
  userId: number;
  status: string;
  total: number;
  items: unknown[];
  createdAt: string;
  updatedAt: string;
}

interface ProductPriceResponse {
  id: number;
  userId: number;
  price: number | null;
  isActive: boolean;
}

interface SkuPriceResponse {
  id: number;
  productId: number;
  price: number;
  stockQuantity: number;
  isActive: boolean;
  tierIdx?: number[];
}

export abstract class BaseAggregatorService {
  protected logger = new Logger(BaseAggregatorService.name);

  protected async aggregate<T>(tasks: Array<Promise<T>>): Promise<T[]> {
    return Promise.all(tasks);
  }

  protected handleError(err: any, serviceName: string) {
    MicroserviceErrorHandler.handleError(
      err,
      "service communication",
      serviceName,
    );
  }
}

interface BuyerInfo {
  id: number;
  username: string;
  email: string;
  name: string | null;
}

interface OrderItemDetail {
  id: number;
  productId: number;
  sellerId: number;
  productName: string;
  quantity: number;
  price: number;
  skuId: number | null;
  skuTierIdx: string | null;
}

interface SellerOrderDetailRaw extends OrderResponse {
  items: OrderItemDetail[];
}

interface ProductDetailResponse {
  id: number;
  name: string;
  imageUrls: string[] | null;
  variations: { name: string; options: string[] }[] | null;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  constructor(
    @Inject(NAME_SERVICE_TCP.ORDERS_SERVICE)
    private readonly ordersClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.PAYMENT_SERVICE)
    private readonly paymentsClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE)
    private readonly productClient: ClientProxy,
    private readonly cached: CachedService,
  ) {}

  /** Sentinel value stored while an idempotent create-order request is in flight. */
  private static readonly IDEMPOTENCY_IN_PROGRESS = "__in_progress__";
  /** Lifetime of the in-flight lock — must outlast the worst-case create latency. */
  private static readonly IDEMPOTENCY_LOCK_TTL_SECONDS = 60;
  /** Replay window: a retry with the same key returns the original response. */
  private static readonly IDEMPOTENCY_RESULT_TTL_SECONDS = 86400;

  /**
   * Idempotent entry point for order creation. When the client supplies an
   * `Idempotency-Key`, a Redis `SET NX` lock guarantees a single create per key:
   * a concurrent double-submit gets 409 while the first is in flight, and a retry
   * after completion replays the original response (orders + paymentUrl) instead
   * of creating a duplicate order or re-initiating payment. Without a key, or if
   * Redis is unavailable, it degrades to a plain create.
   */
  async createOrder(
    userId: number,
    dto: CreateOrderDto,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const key = idempotencyKey?.trim();
    if (!key) {
      return this.createOrderInternal(userId, dto);
    }

    const cacheKey = `idem:order:${userId}:${key}`;
    let claimed: boolean;
    try {
      claimed = await this.cached.setNx(
        cacheKey,
        OrderService.IDEMPOTENCY_IN_PROGRESS,
        OrderService.IDEMPOTENCY_LOCK_TTL_SECONDS,
      );
      if (!claimed) {
        const existing = await this.cached.get(cacheKey);
        if (existing && existing !== OrderService.IDEMPOTENCY_IN_PROGRESS) {
          this.logger.log(
            `Idempotent replay for key ${key} (user ${userId}) — returning cached order response`,
          );
          return JSON.parse(existing) as unknown;
        }
        throw new ConflictException(
          "A duplicate order request is already being processed",
        );
      }
    } catch (err) {
      if (err instanceof ConflictException) {
        throw err;
      }
      // Redis unavailable — never block a real order on the idempotency cache
      this.logger.warn(
        `Idempotency cache unavailable for key ${key}; proceeding without it: ${String(err)}`,
      );
      return this.createOrderInternal(userId, dto);
    }

    try {
      const result = await this.createOrderInternal(userId, dto);
      try {
        await this.cached.set(
          cacheKey,
          JSON.stringify(result),
          OrderService.IDEMPOTENCY_RESULT_TTL_SECONDS,
        );
      } catch (cacheErr) {
        this.logger.warn(
          `Failed to cache idempotent order response for key ${key}: ${String(cacheErr)}`,
        );
      }
      return result;
    } catch (error) {
      // Release the lock so a legitimately failed request can be retried
      await this.cached.del(cacheKey).catch(() => undefined);
      throw error;
    }
  }

  private async createOrderInternal(
    userId: number,
    dto: CreateOrderDto,
  ): Promise<unknown> {
    // Fetch authoritative prices and sellerId from product service
    const enrichedItems = await Promise.all(
      dto.items.map(async (item) => {
        let price: number;
        let tierIdx: number[] | undefined;
        let sellerId: number;

        if (item.skuId) {
          const sku = await firstValueFrom(
            this.productClient
              .send<SkuPriceResponse>(
                PRODUCT_MESSAGE_PATTERNS.SKU_FIND_BY_ID,
                item.skuId,
              )
              .pipe(timeout(10000)),
          ).catch((err: unknown) =>
            MicroserviceErrorHandler.handleError(
              err,
              `fetch SKU ${item.skuId}`,
              "Product Service",
            ),
          );
          if (!sku.isActive) {
            throw new BadRequestException(`SKU ${item.skuId} is not available`);
          }
          if (Number(sku.productId) !== item.productId) {
            throw new BadRequestException(
              `SKU ${item.skuId} does not belong to product ${item.productId}`,
            );
          }
          if (sku.stockQuantity < item.quantity) {
            throw new BadRequestException(
              `Insufficient stock for SKU ${item.skuId}: requested ${item.quantity}, available ${sku.stockQuantity}`,
            );
          }
          price = Number(sku.price);
          tierIdx = Array.isArray(sku.tierIdx) ? sku.tierIdx : undefined;

          // Fetch product to get sellerId (sku response has productId but not userId)
          const product = await firstValueFrom(
            this.productClient
              .send<ProductPriceResponse>(
                PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID,
                item.productId,
              )
              .pipe(timeout(10000)),
          ).catch((err: unknown) =>
            MicroserviceErrorHandler.handleError(
              err,
              `fetch product ${item.productId}`,
              "Product Service",
            ),
          );
          sellerId = Number(product.userId);
        } else {
          const product = await firstValueFrom(
            this.productClient
              .send<ProductPriceResponse>(
                PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID,
                item.productId,
              )
              .pipe(timeout(10000)),
          ).catch((err: unknown) =>
            MicroserviceErrorHandler.handleError(
              err,
              `fetch product ${item.productId}`,
              "Product Service",
            ),
          );
          if (!product.isActive) {
            throw new BadRequestException(
              `Product ${item.productId} is not available`,
            );
          }
          if (product.price === null) {
            throw new BadRequestException(
              `Product ${item.productId} requires a skuId — it has no base price`,
            );
          }
          price = Number(product.price);
          sellerId = Number(product.userId);
        }

        return { ...item, price, skuId: item.skuId ?? null, tierIdx, sellerId };
      }),
    );

    const uniqueSellerIds = new Set(enrichedItems.map((i) => i.sellerId));
    const isMultiSeller = uniqueSellerIds.size > 1;

    try {
      if (isMultiSeller) {
        const orders = (await firstValueFrom(
          this.ordersClient
            .send(ORDER_MESSAGE_PATTERN.CREATE_MULTI_SELLER_ORDER, {
              userId,
              paymentMethod: dto.paymentMethod,
              shippingAddress: dto.shippingAddress,
              items: enrichedItems,
            })
            .pipe(
              timeout(10000),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        )) as OrderResponse[];

        if (dto.paymentMethod === PaymentMethod.COD) {
          return { orders, paymentUrl: null };
        }

        const orderIds = orders.map((o) => o.id);
        const totalAmount = orders.reduce((sum, o) => sum + Number(o.total), 0);
        let paymentUrl: string;
        try {
          const payment = (await firstValueFrom(
            this.paymentsClient
              .send(PAYMENT_MESSAGE_PATTERN.INITIATE_MULTI_ORDER_PAYMENT, {
                orderIds,
                totalAmount,
                paymentMethod: dto.paymentMethod,
              })
              .pipe(
                timeout(10000),
                catchError((err: unknown) => {
                  throw err;
                }),
              ),
          )) as {
            paymentUrl: string;
            transactionId: string;
            appTransId: string;
          };
          paymentUrl = payment.paymentUrl;
        } catch (error) {
          await this.cancelOrdersAfterPaymentInitializationFailure(
            orders,
            userId,
          );
          throw error;
        }

        return { orders, paymentUrl };
      }

      return (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.CREATE_ORDER, {
            userId,
            paymentMethod: dto.paymentMethod,
            shippingAddress: dto.shippingAddress,
            items: enrichedItems,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as unknown;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create order",
        "Orders Service",
      );
    }
  }

  private async cancelOrdersAfterPaymentInitializationFailure(
    orders: OrderResponse[],
    userId: number,
  ): Promise<void> {
    await Promise.all(
      orders.map((order) =>
        firstValueFrom(
          this.ordersClient
            .send(ORDER_MESSAGE_PATTERN.CANCEL_ORDER, {
              orderId: order.id,
              callerId: userId,
              callerRole: "user",
            })
            .pipe(timeout(10000)),
        ).catch((error: unknown) => {
          this.logger.error(
            `Failed to compensate order ${order.id} after payment initialization failure: ${String(error)}`,
          );
        }),
      ),
    );
  }

  async calculateShippingFee(dto: ShippingFeeDto): Promise<{
    shippingFee: number;
    expectedDeliveryTime: string | null;
  }> {
    try {
      return (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.CALCULATE_SHIPPING_FEE, {
            shippingAddress: dto.shippingAddress,
            items: dto.items,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as { shippingFee: number; expectedDeliveryTime: string | null };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "calculate shipping fee",
        "Orders Service",
      );
    }
  }

  async getOrderById(
    orderId: string,
    callerId: number,
    callerRole: string,
  ): Promise<OrderResponse> {
    const id = Number(orderId);
    if (isNaN(id)) {
      MicroserviceErrorHandler.handleError(
        new Error("Invalid orderId"),
        "get order by id",
        "Orders Service",
      );
    }
    const order = (await firstValueFrom(
      this.ordersClient.send(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID, id).pipe(
        timeout(10000),
        catchError((err: unknown) => {
          throw err;
        }),
      ),
    )) as OrderResponse | null;

    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    if (callerRole !== "admin" && Number(order.userId) !== callerId) {
      throw new ForbiddenException("You do not have access to this order");
    }

    const items = (order.items ?? []) as OrderItemDetail[];
    const productMap = await this.buildProductMap(
      items.map((i) => Number(i.productId)),
    );
    return {
      ...order,
      items: items.map((item) => this.decorateItem(item, productMap)),
    };
  }

  async getOrderByUser(
    userId: string,
    page: number,
    limit: number,
    callerId: number,
    callerRole: string,
  ): Promise<{
    data: unknown[];
    total: number;
    page: number;
    limit: number;
  }> {
    const uid = Number(userId);
    if (isNaN(uid)) {
      MicroserviceErrorHandler.handleError(
        new Error("Invalid userId"),
        "get orders by user",
        "Orders Service",
      );
    }
    if (callerRole !== "admin" && uid !== callerId) {
      throw new ForbiddenException("You cannot access another user's orders");
    }
    const result = (await firstValueFrom(
      this.ordersClient
        .send(ORDER_MESSAGE_PATTERN.GET_ORDERS_BY_USER, {
          userId: uid,
          page,
          limit,
        })
        .pipe(
          timeout(10000),
          catchError((err: unknown) => {
            throw err;
          }),
        ),
    )) as {
      data: (Omit<OrderResponse, "items"> & { items: OrderItemDetail[] })[];
      total: number;
      page: number;
      limit: number;
    };

    // Enrich every item across the page in one batched product fetch (P1-02)
    const productMap = await this.buildProductMap(
      result.data.flatMap((o) =>
        (o.items ?? []).map((i) => Number(i.productId)),
      ),
    );
    const data = result.data.map((order) => ({
      ...order,
      items: (order.items ?? []).map((item) =>
        this.decorateItem(item, productMap),
      ),
    }));

    return { ...result, data };
  }

  /**
   * Per-status order counts for a buyer's tab badges (P1-02). Counts span the
   * full order history (server-side GROUP BY), not just the loaded page.
   */
  async getOrderStatusCounts(
    userId: string,
    callerId: number,
    callerRole: string,
  ): Promise<Record<string, number>> {
    const uid = Number(userId);
    if (isNaN(uid)) {
      MicroserviceErrorHandler.handleError(
        new Error("Invalid userId"),
        "get order status counts",
        "Orders Service",
      );
    }
    if (callerRole !== "admin" && uid !== callerId) {
      throw new ForbiddenException("You cannot access another user's orders");
    }
    try {
      return (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDER_STATUS_COUNTS, uid)
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as Record<string, number>;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get order status counts",
        "Orders Service",
      );
    }
  }

  async cancelOrder(
    orderId: number,
    callerId: number,
    callerRole: string,
  ): Promise<OrderResponse> {
    try {
      return (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.CANCEL_ORDER, {
            orderId,
            callerId,
            callerRole,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as OrderResponse;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "cancel order",
        "Orders Service",
      );
    }
  }

  async getOrderInvoice(
    orderId: number,
    requestingUserId: number,
  ): Promise<Buffer> {
    try {
      const result = await firstValueFrom(
        this.ordersClient
          .send<{
            type: string;
            data: number[];
          }>(ORDER_MESSAGE_PATTERN.GET_ORDER_INVOICE, {
            orderId,
            requestingUserId,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
      return Buffer.from(result.data);
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get order invoice",
        "Orders Service",
      );
    }
  }

  async getPaymentUrl(
    orderId: number,
    callerId: number,
    callerRole: string,
  ): Promise<{ orderUrl: string | null; status: string | null }> {
    await this.getOrderById(String(orderId), callerId, callerRole);
    try {
      return (await firstValueFrom(
        this.paymentsClient
          .send(PAYMENT_MESSAGE_PATTERN.GET_PAYMENT_URL, { orderId })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as { orderUrl: string | null; status: string | null };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get payment url",
        "Payments Service",
      );
    }
  }

  async getAdminOrders(
    page: number,
    limit: number,
  ): Promise<{
    data: (OrderResponse & { buyer: BuyerInfo | null })[];
    total: number;
    page: number;
    limit: number;
  }> {
    const result = (await firstValueFrom(
      this.ordersClient
        .send(ORDER_MESSAGE_PATTERN.GET_ALL_ORDERS, { page, limit })
        .pipe(
          timeout(10000),
          catchError((err: unknown) => {
            throw err;
          }),
        ),
    )) as { data: OrderResponse[]; total: number; page: number; limit: number };

    const userIds = [...new Set(result.data.map((o) => Number(o.userId)))];

    let buyers: BuyerInfo[] = [];
    if (userIds.length > 0) {
      try {
        buyers = (await firstValueFrom(
          this.userClient
            .send({ cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS }, userIds)
            .pipe(
              timeout(10000),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        )) as BuyerInfo[];
      } catch (error) {
        MicroserviceErrorHandler.handleError(
          error,
          "get users by ids",
          "User Service",
        );
      }
    }

    const buyerMap = new Map<number, BuyerInfo>(buyers.map((b) => [b.id, b]));

    const data = result.data.map((order) => ({
      ...order,
      buyer: buyerMap.get(Number(order.userId)) ?? null,
    }));

    return {
      data,
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  async getSellerOrders(
    sellerId: number,
    query: SellerOrdersQueryDto,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDERS_BY_SELLER, {
            sellerId,
            page: query.page ?? 1,
            limit: query.limit ?? 20,
            status: query.status,
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
        "get seller orders",
        "Orders Service",
      );
    }
  }

  async confirmOrder(orderId: number, sellerId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.CONFIRM_ORDER, { orderId, sellerId })
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
        "confirm order",
        "Orders Service",
      );
    }
  }

  async readyToShip(orderId: number, sellerId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.READY_TO_SHIP, { orderId, sellerId })
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
        "ready to ship",
        "Orders Service",
      );
    }
  }

  /**
   * Owner/admin-scoped order detail for sellers. The buyer-facing GET /order/:id
   * 403s a seller; this path verifies ownership in the orders service, then
   * enriches each item with the product image and a human-readable SKU label
   * built from the product variations + the per-item tier index (P1-01).
   */
  async getSellerOrderDetail(
    orderId: number,
    sellerId: number,
    isAdmin: boolean,
  ): Promise<unknown> {
    let order: SellerOrderDetailRaw;
    try {
      order = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_SELLER_ORDER_DETAIL, {
            orderId,
            sellerId,
            isAdmin,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as SellerOrderDetailRaw;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get seller order detail",
        "Orders Service",
      );
    }

    const items = order.items ?? [];
    const productMap = await this.buildProductMap(
      items.map((i) => Number(i.productId)),
    );
    const enrichedItems = items.map((item) =>
      this.decorateItem(item, productMap),
    );

    return { ...order, items: enrichedItems };
  }

  /**
   * Fetch product detail (image + variations) for a set of product ids in
   * parallel, de-duplicated. Failures are logged and skipped so a single
   * missing product never fails the whole order response.
   */
  private async buildProductMap(
    productIds: number[],
  ): Promise<Map<number, ProductDetailResponse>> {
    const productMap = new Map<number, ProductDetailResponse>();
    await Promise.all(
      [...new Set(productIds)].map(async (pid) => {
        try {
          const product = await firstValueFrom(
            this.productClient
              .send<ProductDetailResponse>(
                PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID,
                pid,
              )
              .pipe(timeout(10000)),
          );
          if (product) {
            productMap.set(pid, product);
          }
        } catch (err) {
          this.logger.warn(`Failed to enrich product ${pid}: ${String(err)}`);
        }
      }),
    );
    return productMap;
  }

  /**
   * Attach the product image and a human-readable SKU label to a single order
   * item, using a pre-fetched product map (P1-02). Shared by the buyer order
   * endpoints and the seller order detail.
   */
  private decorateItem(
    item: { productId: number | string; skuTierIdx?: string | null },
    productMap: Map<number, ProductDetailResponse>,
  ): Record<string, unknown> {
    const product = productMap.get(Number(item.productId));
    return {
      ...item,
      image: product?.imageUrls?.[0] ?? null,
      skuLabel: this.buildSkuLabel(
        product?.variations,
        item.skuTierIdx ?? null,
      ),
    };
  }

  /**
   * Build a human-readable SKU label (e.g. "Color: Red, Size: M") from the
   * product variations and the per-item tier index. `skuTierIdx` is a JSON
   * string of option indices, one per variation. Returns null when the SKU has
   * no variation selection or the product variations are unavailable.
   */
  private buildSkuLabel(
    variations: { name: string; options: string[] }[] | null | undefined,
    skuTierIdx: string | null,
  ): string | null {
    if (!skuTierIdx || !variations || variations.length === 0) {
      return null;
    }
    let indices: number[];
    try {
      const parsed = JSON.parse(skuTierIdx) as unknown;
      if (!Array.isArray(parsed)) {
        return null;
      }
      indices = parsed.map((n) => Number(n));
    } catch {
      return null;
    }
    const parts: string[] = [];
    indices.forEach((optIdx, varIdx) => {
      const variation = variations[varIdx];
      const option = variation?.options?.[optIdx];
      if (variation && option != null) {
        parts.push(`${variation.name}: ${option}`);
      }
    });
    return parts.length > 0 ? parts.join(", ") : null;
  }

  async advanceOrderStatus(
    orderId: number,
    sellerId: number,
    isAdmin: boolean,
    targetStatus: string,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADVANCE_ORDER_STATUS, {
            orderId,
            sellerId,
            isAdmin,
            targetStatus,
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
        "advance order status",
        "Orders Service",
      );
    }
  }
}
