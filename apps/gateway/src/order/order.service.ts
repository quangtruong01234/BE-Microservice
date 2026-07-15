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
import {
  ORDER_MESSAGE,
  PRODUCT_MESSAGE,
  VOUCHER_MESSAGE,
} from "libs/constant/response-message.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { PaymentMethod } from "@app/common";
import { CreateOrderDto } from "./dto/create-order.dto";
import { CreateVoucherDto, ValidateVoucherDto } from "./dto/voucher.dto";
import { SellerOrdersQueryDto } from "./dto/seller-orders-query.dto";
import { ShippingFeeDto } from "./dto/shipping-fee.dto";
import { AdminGhnOrdersQueryDto } from "./dto/admin-ghn-orders-query.dto";
import { AnalyticsQueryDto } from "./dto/analytics-query.dto";
import {
  AdminGhnOrderListItem,
  AdminGhnOrderListResult,
  BuyerInfo,
  EnrichedOrderItem,
  OrderItemDetail,
  OrderResponse,
  ProductDetailResponse,
  ProductPriceResponse,
  SellerOrderDetailRaw,
  SkuPriceResponse,
  UserSummary,
} from "./order.types";

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
          ORDER_MESSAGE.DUPLICATE_REQUEST_IN_PROGRESS,
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

  /**
   * Resolve authoritative price, sellerId and purchase-time snapshot for each
   * requested item from the product service. Shared by order creation and the
   * voucher preview so both price the basket identically.
   */
  private async enrichOrderItems(
    items: CreateOrderDto["items"],
  ): Promise<EnrichedOrderItem[]> {
    // Dedupe product fetches: repeated productIds across items share one
    // in-flight request instead of re-fetching per line (PERF-08).
    const productPromiseById = new Map<number, Promise<ProductPriceResponse>>();
    const fetchProduct = (productId: number): Promise<ProductPriceResponse> => {
      const inFlight = productPromiseById.get(productId);
      if (inFlight) {
        return inFlight;
      }
      const pending = firstValueFrom(
        this.productClient
          .send<ProductPriceResponse>(
            PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_ID,
            productId,
          )
          .pipe(timeout(10000)),
      ).catch((err: unknown) =>
        MicroserviceErrorHandler.handleError(
          err,
          `fetch product ${productId}`,
          "Product Service",
        ),
      );
      productPromiseById.set(productId, pending);
      return pending;
    };

    return Promise.all(
      items.map(async (item) => {
        let price: number;
        let tierIdx: number[] | undefined;
        let sellerId: number;
        // Purchase-time snapshot (P2-02): resolved from the authoritative product
        // so historical orders render correctly even if the product is later
        // edited or deleted.
        let productImage: string | null = null;
        let skuLabel: string | null = null;

        if (item.skuId) {
          const skuPromise = firstValueFrom(
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
          // The product lookup only depends on item.productId (known upfront),
          // not on the SKU response — fetch both in parallel (PERF-08).
          const [sku, product] = await Promise.all([
            skuPromise,
            fetchProduct(item.productId),
          ]);
          if (!sku.isActive) {
            throw new BadRequestException(
              PRODUCT_MESSAGE.SKU_NOT_AVAILABLE(item.skuId),
            );
          }
          if (Number(sku.productId) !== item.productId) {
            throw new BadRequestException(
              PRODUCT_MESSAGE.SKU_NOT_OF_PRODUCT(item.skuId, item.productId),
            );
          }
          if (sku.stockQuantity < item.quantity) {
            throw new BadRequestException(
              PRODUCT_MESSAGE.SKU_INSUFFICIENT_STOCK(
                item.skuId,
                item.quantity,
                sku.stockQuantity,
              ),
            );
          }
          price = Number(sku.price);
          tierIdx = Array.isArray(sku.tierIdx) ? sku.tierIdx : undefined;

          sellerId = Number(product.userId);
          productImage = product.imageUrls?.[0] ?? null;
          skuLabel = tierIdx
            ? this.buildSkuLabel(
                product.variations ?? null,
                JSON.stringify(tierIdx),
              )
            : null;
        } else {
          const product = await fetchProduct(item.productId);
          if (!product.isActive) {
            throw new BadRequestException(
              PRODUCT_MESSAGE.NOT_AVAILABLE(item.productId),
            );
          }
          if (product.price === null) {
            throw new BadRequestException(
              PRODUCT_MESSAGE.REQUIRES_SKU(item.productId),
            );
          }
          price = Number(product.price);
          sellerId = Number(product.userId);
          productImage = product.imageUrls?.[0] ?? null;
        }

        return {
          ...item,
          price,
          skuId: item.skuId ?? null,
          tierIdx,
          sellerId,
          productImage,
          skuLabel,
        };
      }),
    );
  }

  private async createOrderInternal(
    userId: number,
    dto: CreateOrderDto,
  ): Promise<unknown> {
    // Fetch authoritative prices and sellerId from product service
    const enrichedItems = await this.enrichOrderItems(dto.items);

    const uniqueSellerIds = new Set(enrichedItems.map((i) => i.sellerId));
    const isMultiSeller = uniqueSellerIds.size > 1;

    if (isMultiSeller && dto.voucherCode) {
      // Discount-splitting across sellers has no defined semantics yet; keep
      // vouchers to single-seller orders.
      throw new BadRequestException(VOUCHER_MESSAGE.SINGLE_SELLER_ONLY);
    }

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

      const createdOrder = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.CREATE_ORDER, {
            userId,
            paymentMethod: dto.paymentMethod,
            shippingAddress: dto.shippingAddress,
            items: enrichedItems,
            voucherCode: dto.voucherCode ?? null,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as Omit<OrderResponse, "items"> & { items?: OrderItemDetail[] };

      // Surface the same explicit price breakdown the read paths expose so the
      // FE checkout confirmation can render subtotal/shipping/discount/total
      // without deriving the shipping fee client-side.
      return {
        ...createdOrder,
        shippingFee: Number(createdOrder.shippingFee ?? 0),
        subtotal: this.computeSubtotal(createdOrder.items ?? []),
      };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create order",
        "Orders Service",
      );
    }
  }

  /**
   * Buyer-facing voucher preview: price the basket via the product service, then
   * ask the orders service to validate the code and compute the discount without
   * consuming a redemption.
   */
  async validateVoucher(
    userId: number,
    dto: ValidateVoucherDto,
  ): Promise<unknown> {
    const enrichedItems = await this.enrichOrderItems(dto.items);
    const uniqueSellerIds = new Set(enrichedItems.map((i) => i.sellerId));
    if (uniqueSellerIds.size > 1) {
      throw new BadRequestException(VOUCHER_MESSAGE.SINGLE_SELLER_ONLY);
    }
    const itemsTotal = enrichedItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    return this.errorHandledSend(
      ORDER_MESSAGE_PATTERN.VOUCHER_VALIDATE,
      { userId, code: dto.code, itemsTotal },
      "validate voucher",
    );
  }

  async createVoucher(dto: CreateVoucherDto): Promise<unknown> {
    return this.errorHandledSend(
      ORDER_MESSAGE_PATTERN.VOUCHER_CREATE,
      dto,
      "create voucher",
    );
  }

  async listVouchers(page: number, limit: number): Promise<unknown> {
    return this.errorHandledSend(
      ORDER_MESSAGE_PATTERN.VOUCHER_LIST,
      { page, limit },
      "list vouchers",
    );
  }

  async deactivateVoucher(id: number): Promise<unknown> {
    return this.errorHandledSend(
      ORDER_MESSAGE_PATTERN.VOUCHER_DEACTIVATE,
      { id },
      "deactivate voucher",
    );
  }

  private async errorHandledSend(
    pattern: string,
    payload: unknown,
    operation: string,
  ): Promise<unknown> {
    try {
      return (await firstValueFrom(
        this.ordersClient.send(pattern, payload).pipe(
          timeout(10000),
          catchError((err: unknown) => {
            throw err;
          }),
        ),
      )) as unknown;
    } catch (error) {
      return MicroserviceErrorHandler.handleError(
        error,
        operation,
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
    orderId: number,
    callerId: number,
    callerRole: string,
  ): Promise<OrderResponse> {
    const order = await this.fetchOwnedOrder(orderId, callerId, callerRole);

    const items = (order.items ?? []) as OrderItemDetail[];
    const productMap = await this.buildProductMap(
      items
        .filter((i) => this.itemNeedsLiveProduct(i))
        .map((i) => Number(i.productId)),
    );
    return {
      ...order,
      shippingFee: Number(order.shippingFee ?? 0),
      subtotal: this.computeSubtotal(items),
      items: items.map((item) => this.decorateItem(item, productMap)),
    };
  }

  // Bare order fetch + owner-or-admin check, WITHOUT product enrichment —
  // use this when only access control is needed (e.g. getPaymentUrl).
  private async fetchOwnedOrder(
    orderId: number,
    callerId: number,
    callerRole: string,
  ): Promise<OrderResponse> {
    const order = (await firstValueFrom(
      this.ordersClient
        .send(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID, orderId)
        .pipe(
          timeout(10000),
          catchError((err: unknown) => {
            throw err;
          }),
        ),
    )) as OrderResponse | null;

    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }

    if (callerRole !== "admin" && Number(order.userId) !== callerId) {
      throw new ForbiddenException(ORDER_MESSAGE.ACCESS_DENIED);
    }

    return order;
  }

  async getOrderByUser(
    userId: number,
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
    if (callerRole !== "admin" && userId !== callerId) {
      throw new ForbiddenException(ORDER_MESSAGE.CANNOT_ACCESS_OTHERS_ORDERS);
    }
    const result = (await firstValueFrom(
      this.ordersClient
        .send(ORDER_MESSAGE_PATTERN.GET_ORDERS_BY_USER, {
          userId,
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
        (o.items ?? [])
          .filter((i) => this.itemNeedsLiveProduct(i))
          .map((i) => Number(i.productId)),
      ),
    );
    const data = result.data.map((order) => ({
      ...order,
      shippingFee: Number(order.shippingFee ?? 0),
      subtotal: this.computeSubtotal(order.items ?? []),
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
    userId: number,
    callerId: number,
    callerRole: string,
  ): Promise<Record<string, number>> {
    if (callerRole !== "admin" && userId !== callerId) {
      throw new ForbiddenException(ORDER_MESSAGE.CANNOT_ACCESS_OTHERS_ORDERS);
    }
    try {
      return (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDER_STATUS_COUNTS, userId)
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
    requestingUserRole = "user",
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
            requestingUserRole,
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
    // Ownership check only — skip getOrderById's product enrichment (PERF-11).
    await this.fetchOwnedOrder(orderId, callerId, callerRole);
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
            .send(
              { cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS },
              { userIds, includeEmail: true },
            )
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

  async getAdminGhnOrders(query: AdminGhnOrdersQueryDto): Promise<
    Omit<AdminGhnOrderListResult, "data"> & {
      data: (AdminGhnOrderListItem & {
        buyer: UserSummary | null;
        seller: UserSummary | null;
      })[];
    }
  > {
    let result: AdminGhnOrderListResult;
    try {
      result = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_ORDERS, {
            page: query.page ?? 1,
            limit: query.limit ?? 20,
            status: query.status,
            ghnStatus: query.ghnStatus,
            hasGhnCode: query.hasGhnCode,
            search: query.search,
            dateFrom: query.dateFrom,
            dateTo: query.dateTo,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as AdminGhnOrderListResult;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get admin GHN orders",
        "Orders Service",
      );
    }

    const users = await this.getUserSummaryMap(
      result.data.flatMap((order) => [order.userId, order.sellerId]),
    );
    return {
      ...result,
      data: result.data.map((order) => ({
        ...order,
        buyer: users.get(Number(order.userId)) ?? null,
        seller: users.get(Number(order.sellerId)) ?? null,
      })),
    };
  }

  async getAdminGhnOrderDetail(orderId: number): Promise<unknown> {
    try {
      const detail = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_ORDER_DETAIL, { orderId })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as {
        localOrder?: { userId?: number; sellerId?: number };
      };
      const userIds = [
        detail.localOrder?.userId,
        detail.localOrder?.sellerId,
      ].filter((id): id is number => typeof id === "number");
      const users = await this.getUserSummaryMap(userIds);
      return {
        ...detail,
        buyer:
          detail.localOrder?.userId === undefined
            ? null
            : (users.get(detail.localOrder.userId) ?? null),
        seller:
          detail.localOrder?.sellerId === undefined
            ? null
            : (users.get(detail.localOrder.sellerId) ?? null),
      };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get admin GHN order detail",
        "Orders Service",
      );
    }
  }

  async syncAdminGhnOrder(
    orderId: number,
    actorId: number | null,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_SYNC, { orderId, actorId })
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
        "sync admin GHN order",
        "Orders Service",
      );
    }
  }

  async getAdminGhnHistory(orderId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_HISTORY, { orderId })
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
        "get admin GHN history",
        "Orders Service",
      );
    }
  }

  async cancelAdminGhnOrder(
    orderId: number,
    actorId: number | null,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_CANCEL, { orderId, actorId })
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
        "cancel admin GHN order",
        "Orders Service",
      );
    }
  }

  async returnAdminGhnOrder(
    orderId: number,
    actorId: number | null,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_RETURN, { orderId, actorId })
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
        "return admin GHN order",
        "Orders Service",
      );
    }
  }

  async updateAdminGhnCod(
    orderId: number,
    actorId: number | null,
    codAmount: number,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_UPDATE_COD, {
            orderId,
            actorId,
            codAmount,
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
        "update admin GHN COD",
        "Orders Service",
      );
    }
  }

  async updateAdminGhnReceiver(
    orderId: number,
    actorId: number | null,
    receiver: { toName?: string; toPhone?: string; toAddress?: string },
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_UPDATE_RECEIVER, {
            orderId,
            actorId,
            ...receiver,
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
        "update admin GHN receiver",
        "Orders Service",
      );
    }
  }

  async setDemoGhnStatus(
    orderId: number,
    actorId: number | null,
    ghnStatus: string,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_DEMO_STATUS, {
            orderId,
            actorId,
            ghnStatus,
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
        "set demo GHN status",
        "Orders Service",
      );
    }
  }

  private async getUserSummaryMap(
    userIds: number[],
  ): Promise<Map<number, UserSummary>> {
    const uniqueIds = [...new Set(userIds.map(Number).filter(Boolean))];
    if (uniqueIds.length === 0) {
      return new Map();
    }
    try {
      const users = (await firstValueFrom(
        this.userClient
          .send(
            { cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS },
            { userIds: uniqueIds, includeEmail: true },
          )
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as UserSummary[];
      return new Map(users.map((user) => [Number(user.id), user]));
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get users by ids",
        "User Service",
      );
    }
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

  async getSellerAnalytics(
    sellerId: number,
    query: AnalyticsQueryDto,
  ): Promise<unknown> {
    return this.fetchAnalytics(sellerId, query, "get seller analytics");
  }

  async getShippingAnalytics(query: AnalyticsQueryDto): Promise<unknown> {
    return this.fetchAnalytics(null, query, "get shipping analytics");
  }

  private async fetchAnalytics(
    sellerId: number | null,
    query: AnalyticsQueryDto,
    operation: string,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ANALYTICS, {
            sellerId,
            from: query.from,
            to: query.to,
            interval: query.interval,
            topN: query.topN,
          })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, operation, "Orders Service");
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
      items
        .filter((i) => this.itemNeedsLiveProduct(i))
        .map((i) => Number(i.productId)),
    );
    const enrichedItems = items.map((item) =>
      this.decorateItem(item, productMap),
    );

    return {
      ...order,
      shippingFee: Number(order.shippingFee ?? 0),
      subtotal: this.computeSubtotal(items),
      items: enrichedItems,
    };
  }

  /**
   * A read-path item only needs a live product fetch when it predates the
   * purchase-time snapshot (P2-02): no stored image, or a SKU selection with no
   * stored label. New orders carry their own snapshot and skip the fetch
   * entirely, so a deleted/edited product no longer breaks historical orders.
   */
  private itemNeedsLiveProduct(item: {
    productImage?: string | null;
    skuTierIdx?: string | null;
    skuLabel?: string | null;
  }): boolean {
    const hasImageSnapshot =
      item.productImage !== undefined && item.productImage !== null;
    const needsLabel =
      !!item.skuTierIdx &&
      (item.skuLabel === undefined || item.skuLabel === null);
    return !hasImageSnapshot || needsLabel;
  }

  /**
   * Goods subtotal (line prices × quantities) for the order price breakdown.
   * `OrderItem.price` has no DECIMAL transformer so mysql2 serializes it as a
   * string over TCP — coerce every factor with Number() before summing. The
   * order money identity is: total = subtotal - discountAmount + shippingFee.
   */
  private computeSubtotal(
    items: { price: number | string; quantity: number | string }[],
  ): number {
    return items.reduce(
      (sum, item) => sum + Number(item.price ?? 0) * Number(item.quantity ?? 0),
      0,
    );
  }

  /**
   * Fetch product detail (image + variations) for a set of product ids in one
   * batched TCP call, de-duplicated (PERF-07: was N per-id sends). Missing ids
   * are skipped by the batch handler and a batch failure degrades to an empty
   * map, so a missing product never fails the whole order response.
   */
  private async buildProductMap(
    productIds: number[],
  ): Promise<Map<number, ProductDetailResponse>> {
    const productMap = new Map<number, ProductDetailResponse>();
    const uniqueProductIds = [...new Set(productIds)];
    if (uniqueProductIds.length === 0) {
      return productMap;
    }
    try {
      const products = await firstValueFrom(
        this.productClient
          .send<
            ProductDetailResponse[]
          >(PRODUCT_MESSAGE_PATTERNS.PRODUCT_FIND_BY_IDS, uniqueProductIds)
          .pipe(timeout(10000)),
      );
      if (Array.isArray(products)) {
        products.forEach((product) => {
          if (product && product.id !== undefined) {
            productMap.set(Number(product.id), product);
          }
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to enrich products [${uniqueProductIds.join(", ")}]: ${String(err)}`,
      );
    }
    return productMap;
  }

  /**
   * Attach the product image and a human-readable SKU label to a single order
   * item, using a pre-fetched product map (P1-02). Shared by the buyer order
   * endpoints and the seller order detail.
   */
  private decorateItem(
    item: {
      productId: number | string;
      skuTierIdx?: string | null;
      productImage?: string | null;
      skuLabel?: string | null;
    },
    productMap: Map<number, ProductDetailResponse>,
  ): Record<string, unknown> {
    const product = productMap.get(Number(item.productId));
    // Prefer the purchase-time snapshot (P2-02) so historical orders render the
    // product as it was at checkout; fall back to the live product only for
    // legacy orders created before the snapshot columns existed.
    return {
      ...item,
      image: item.productImage ?? product?.imageUrls?.[0] ?? null,
      skuLabel:
        item.skuLabel ??
        this.buildSkuLabel(product?.variations, item.skuTierIdx ?? null),
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

  // ----------------------------------------------------------------------------
  // F2 — Buyer-initiated return / refund request
  // ----------------------------------------------------------------------------

  async requestReturn(
    orderId: number,
    userId: number,
    reason: string,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.RETURN_REQUEST_CREATE, {
            orderId,
            userId,
            reason,
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
        "request order return",
        "Orders Service",
      );
    }
  }

  async getMyReturnRequests(
    userId: number,
    page: number,
    limit: number,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.RETURN_REQUEST_LIST_USER, {
            userId,
            page,
            limit,
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
        "list own return requests",
        "Orders Service",
      );
    }
  }

  async getManagedReturnRequests(
    sellerId: number,
    isAdmin: boolean,
    page: number,
    limit: number,
    status?: string,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.RETURN_REQUEST_LIST_MANAGED, {
            sellerId,
            isAdmin,
            page,
            limit,
            status,
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
        "list managed return requests",
        "Orders Service",
      );
    }
  }

  async reviewReturnRequest(
    requestId: number,
    reviewerId: number,
    reviewerRole: string,
    decision: "approve" | "reject",
    rejectReason?: string,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.RETURN_REQUEST_REVIEW, {
            requestId,
            reviewerId,
            reviewerRole,
            decision,
            rejectReason,
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
        "review return request",
        "Orders Service",
      );
    }
  }
}
