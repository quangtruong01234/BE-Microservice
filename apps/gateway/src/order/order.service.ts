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
import { retryOnTransportError } from "../common/exception/transport-error";
import { isPublicId, PaginatedResponse, PaymentMethod } from "@app/common";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";
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
  OrderAnalyticsResponse,
  OrderItemDetail,
  OrderResponse,
  ProductDetailResponse,
  ProductPriceResponse,
  SellerOrderDetailRaw,
  SkuPriceResponse,
  UserSummary,
} from "./order.types";
import { TCP_TIMEOUT_MS } from "libs/constant/tcp-timeout.constant";
import { OrderStatusValue } from "libs/constant/order-status.constant";
import { READ_ONLY_SHIPPING_ACTIONS } from "libs/constant/shipping.constant";

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
      return this.exposeUserReferences(
        await this.createOrderInternal(userId, dto),
      );
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
          return this.exposeUserReferences(JSON.parse(existing) as unknown);
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
      return this.exposeUserReferences(
        await this.createOrderInternal(userId, dto),
      );
    }

    try {
      const result = await this.exposeUserReferences(
        await this.createOrderInternal(userId, dto),
      );
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
    const productPromiseById = new Map<string, Promise<ProductPriceResponse>>();
    const fetchProduct = (productId: string): Promise<ProductPriceResponse> => {
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
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
        let internalProductId: number;
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
              .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
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
          if (Number(sku.productId) !== Number(product.id)) {
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
          internalProductId = Number(product.id);
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
          internalProductId = Number(product.id);
          sellerId = Number(product.userId);
          productImage = product.imageUrls?.[0] ?? null;
        }

        return {
          ...item,
          productId: internalProductId,
          productPublicId: item.productId,
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
    const publicProductIdByInternalId = new Map(
      enrichedItems.map((item, index) => [
        item.productId,
        dto.items[index].productId,
      ]),
    );
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
              toDistrictId: dto.toDistrictId ?? null,
              toWardCode: dto.toWardCode ?? null,
              items: enrichedItems,
            })
            .pipe(
              timeout(TCP_TIMEOUT_MS.WRITE),
              catchError((err: unknown) => {
                throw err;
              }),
            ),
        )) as OrderResponse[];

        if (dto.paymentMethod === PaymentMethod.COD) {
          return {
            orders: orders.map((order) =>
              this.exposeOrderWithProductIdMap(
                order,
                publicProductIdByInternalId,
              ),
            ),
            paymentUrl: null,
          };
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
                timeout(TCP_TIMEOUT_MS.WRITE),
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

        return {
          orders: orders.map((order) =>
            this.exposeOrderWithProductIdMap(
              order,
              publicProductIdByInternalId,
            ),
          ),
          paymentUrl,
        };
      }

      const createdOrder = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.CREATE_ORDER, {
            userId,
            paymentMethod: dto.paymentMethod,
            shippingAddress: dto.shippingAddress,
            toDistrictId: dto.toDistrictId ?? null,
            toWardCode: dto.toWardCode ?? null,
            items: enrichedItems,
            voucherCode: dto.voucherCode ?? null,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as Omit<OrderResponse, "items"> & { items?: OrderItemDetail[] };

      // Surface the same explicit price breakdown the read paths expose so the
      // FE checkout confirmation can render subtotal/shipping/discount/total
      // without deriving the shipping fee client-side.
      return this.exposeOrderWithProductIdMap(
        {
          ...createdOrder,
          shippingFee: Number(createdOrder.shippingFee ?? 0),
          subtotal: this.computeSubtotal(createdOrder.items ?? []),
        },
        publicProductIdByInternalId,
      );
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
          timeout(TCP_TIMEOUT_MS.WRITE),
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
            .pipe(timeout(TCP_TIMEOUT_MS.WRITE)),
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
            toDistrictId: dto.toDistrictId ?? null,
            toWardCode: dto.toWardCode ?? null,
            items: dto.items,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
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
  ): Promise<Record<string, unknown>> {
    const order = await this.fetchOwnedOrder(orderId, callerId, callerRole);

    const items = (order.items ?? []) as OrderItemDetail[];
    const productMap = await this.buildProductMap(
      items.map((i) => Number(i.productId)),
    );
    return (await this.exposeUserReferences(
      this.exposeOrder({
        ...order,
        shippingFee: Number(order.shippingFee ?? 0),
        subtotal: this.computeSubtotal(items),
        items: items.map((item) => this.decorateItem(item, productMap)),
      }),
    )) as Record<string, unknown>;
  }

  // Bare order fetch + owner-or-admin check, WITHOUT product enrichment —
  // use this when only access control is needed (e.g. getPaymentUrl).
  private async fetchOwnedOrder(
    orderId: string,
    callerId: number,
    callerRole: string,
  ): Promise<OrderResponse> {
    let order: OrderResponse | null;
    try {
      order = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID, orderId)
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as OrderResponse | null;
    } catch (error) {
      // Without this the orders-service RpcException (e.g. an unresolvable
      // public id -> NotFound) reaches Nest raw and is mapped to 500.
      MicroserviceErrorHandler.handleError(
        error,
        "get order",
        "Orders Service",
      );
    }

    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }

    if (callerRole !== "admin" && Number(order.userId) !== callerId) {
      throw new ForbiddenException(ORDER_MESSAGE.ACCESS_DENIED);
    }

    return order;
  }

  /**
   * PUBID-01: the HTTP boundary exposes ONLY the opaque public id (`ord_...`).
   * Replaces the numeric `id` with `publicId` (stringified PK fallback for rows
   * predating the backfill) and drops the internal copies — the `publicId`
   * field itself and each item's numeric `orderId` FK.
   */
  /**
   * PUBID-02: user embeds (buyer/seller) expose the opaque `usr_...` id and
   * drop the internal copies, mirroring exposeOrder.
   */
  private exposeUserSummary<
    T extends { id: number | string; publicId?: string | null },
  >(user: T): T {
    const exposed = { ...user, id: user.publicId ?? String(user.id) };
    delete (exposed as { publicId?: string | null }).publicId;
    return exposed;
  }

  private async resolveUserId(userId: number | string): Promise<number> {
    if (typeof userId === "number") return userId;
    const user = await firstValueFrom(
      this.userClient
        .send<{
          id: number;
        }>({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, { userId })
        .pipe(timeout(TCP_TIMEOUT_MS.READ), retryOnTransportError()),
    );
    return Number(user.id);
  }

  private async exposeUserReferences(value: unknown): Promise<unknown> {
    const userReferenceKeys = new Set([
      "userId",
      "sellerId",
      "reviewerId",
      // The return-request column is `reviewedBy`, not `reviewerId` — without
      // it the moderator's internal row id shipped raw on all four
      // return-request paths (PRODTEST-0806 #4).
      "reviewedBy",
      "requestedBy",
      "resolvedBy",
      "actorId",
    ]);
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
          userReferenceKeys.has(key) &&
          nestedValue !== null &&
          Number.isFinite(Number(nestedValue))
        ) {
          userIds.add(Number(nestedValue));
        }
        collect(nestedValue);
      }
    };
    collect(value);
    const users = await this.getUserSummaryMap([...userIds]);
    const expose = (nested: unknown): unknown => {
      if (Array.isArray(nested)) return nested.map(expose);
      if (!nested || typeof nested !== "object") return nested;
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>).map(
          ([key, nestedValue]) => [
            key,
            userReferenceKeys.has(key) && nestedValue !== null
              ? (users.get(Number(nestedValue))?.id ?? null)
              : expose(nestedValue),
          ],
        ),
      );
    };
    return expose(value);
  }

  private exposeOrder(
    order: Partial<OrderResponse> & { id: number },
  ): Record<string, unknown> {
    const exposed: Record<string, unknown> = {
      ...order,
      id: order.publicId ?? String(order.id),
    };
    delete exposed.publicId;
    if (Array.isArray(order.items)) {
      exposed.items = order.items.map((item) => {
        if (!item || typeof item !== "object") {
          return item;
        }
        const cleaned: Record<string, unknown> = {
          ...(item as Record<string, unknown>),
        };
        cleaned.productId = isPublicId(
          PUBLIC_ID_PREFIXES.PRODUCT,
          cleaned.productId,
        )
          ? cleaned.productId
          : null;
        delete cleaned.productPublicId;
        delete cleaned.orderId;
        return cleaned;
      });
    }
    return exposed;
  }

  private exposeOrderWithProductIdMap(
    order: Partial<OrderResponse> & { id: number },
    publicIdByInternalId: Map<number, string>,
  ): Record<string, unknown> {
    return this.exposeOrder({
      ...order,
      items: Array.isArray(order.items)
        ? order.items.map((item) => {
            if (!item || typeof item !== "object") return item;
            const row = item as { productId?: number | string } & Record<
              string,
              unknown
            >;
            return {
              ...row,
              productId:
                row.productId === undefined
                  ? null
                  : (publicIdByInternalId.get(Number(row.productId)) ?? null),
            };
          })
        : order.items,
    });
  }

  private async exposeOrderWithProducts(
    order: OrderResponse,
  ): Promise<Record<string, unknown>> {
    const items = (order.items ?? []) as OrderItemDetail[];
    const productMap = await this.buildProductMap(
      items.map((item) => Number(item.productId)),
    );
    return (await this.exposeUserReferences(
      this.exposeOrder({
        ...order,
        items: items.map((item) => this.decorateItem(item, productMap)),
      }),
    )) as Record<string, unknown>;
  }

  /**
   * PUBID-01: return-request rows expose the parent order's public id as
   * `orderId` (the orders service attaches `orderPublicId` for this purpose).
   * PUBID-04 also replaces the request's own numeric id with `rr_...`.
   */
  private exposeReturnRequest(
    request: Record<string, unknown> & {
      orderId?: number | string;
      orderPublicId?: string | null;
    },
  ): Record<string, unknown> {
    const exposed: Record<string, unknown> = {
      ...request,
      id: request.publicId ?? String(request.id),
      orderId: request.orderPublicId ?? String(request.orderId),
    };
    delete exposed.publicId;
    delete exposed.orderPublicId;
    return exposed;
  }

  async getOrderByUser(
    userId: number | string,
    page: number,
    limit: number,
    callerId: number,
    callerRole: string,
    status?: OrderStatusValue[],
    q?: string,
  ): Promise<{
    data: unknown[];
    total: number;
    page: number;
    limit: number;
  }> {
    const internalUserId = await this.resolveUserId(userId);
    if (callerRole !== "admin" && internalUserId !== callerId) {
      throw new ForbiddenException(ORDER_MESSAGE.CANNOT_ACCESS_OTHERS_ORDERS);
    }
    const result = (await firstValueFrom(
      this.ordersClient
        .send(ORDER_MESSAGE_PATTERN.GET_ORDERS_BY_USER, {
          userId: internalUserId,
          page,
          limit,
          status: status?.length ? status : undefined,
          q: q?.length ? q : undefined,
        })
        .pipe(
          timeout(TCP_TIMEOUT_MS.READ),
          retryOnTransportError(),
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
    const data = result.data.map((order) =>
      this.exposeOrder({
        ...order,
        shippingFee: Number(order.shippingFee ?? 0),
        subtotal: this.computeSubtotal(order.items ?? []),
        items: (order.items ?? []).map((item) =>
          this.decorateItem(item, productMap),
        ),
      }),
    );

    return (await this.exposeUserReferences({ ...result, data })) as {
      data: unknown[];
      total: number;
      page: number;
      limit: number;
    };
  }

  /**
   * Per-status order counts for a buyer's tab badges (P1-02). Counts span the
   * full order history (server-side GROUP BY), not just the loaded page.
   */
  async getOrderStatusCounts(
    userId: number | string,
    callerId: number,
    callerRole: string,
  ): Promise<Record<string, number>> {
    const internalUserId = await this.resolveUserId(userId);
    if (callerRole !== "admin" && internalUserId !== callerId) {
      throw new ForbiddenException(ORDER_MESSAGE.CANNOT_ACCESS_OTHERS_ORDERS);
    }
    try {
      return (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDER_STATUS_COUNTS, internalUserId)
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
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
    orderId: string,
    callerId: number,
    callerRole: string,
  ): Promise<Record<string, unknown>> {
    try {
      const canceled = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.CANCEL_ORDER, {
            orderId,
            callerId,
            callerRole,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as OrderResponse;
      return this.exposeOrderWithProducts(canceled);
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "cancel order",
        "Orders Service",
      );
    }
  }

  async getOrderInvoice(
    orderId: string,
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
            timeout(TCP_TIMEOUT_MS.WRITE),
            retryOnTransportError(),
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
    orderId: string,
    callerId: number,
    callerRole: string,
  ): Promise<{ orderUrl: string | null; status: string | null }> {
    // Ownership check only — skip getOrderById's product enrichment (PERF-11).
    // The payments TCP contract stays numeric (PUBID-01) — send the resolved PK.
    const order = await this.fetchOwnedOrder(orderId, callerId, callerRole);
    try {
      return (await firstValueFrom(
        this.paymentsClient
          .send(PAYMENT_MESSAGE_PATTERN.GET_PAYMENT_URL, {
            orderId: order.id,
            // Lets payments re-issue the checkout URL when a previous attempt
            // saved the row but failed before persisting the gateway URL.
            paymentMethod: order.paymentMethod,
            // Only the provider return URL needs it: the FE deep-links back
            // with `?order=`, which HTTP resolves as a public id.
            publicOrderId: order.publicId ?? null,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
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

  /**
   * PRODTEST-0806: returns the standard `PaginatedResponse` envelope — it used
   * to drop `totalPages`/`hasNext` that every sibling list route provides.
   */
  async getAdminOrders(
    page: number,
    limit: number,
    status?: OrderStatusValue[],
    q?: string,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    const result = (await firstValueFrom(
      this.ordersClient
        .send(ORDER_MESSAGE_PATTERN.GET_ALL_ORDERS, {
          page,
          limit,
          status: status?.length ? status : undefined,
          q: q?.length ? q : undefined,
        })
        .pipe(
          timeout(TCP_TIMEOUT_MS.READ),
          retryOnTransportError(),
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
              timeout(TCP_TIMEOUT_MS.READ),
              retryOnTransportError(),
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

    // Map keys stay the internal numeric id (matches order.userId); the
    // embedded buyer `id` is the exposed opaque public id (PUBID-02).
    const buyerMap = new Map<number, BuyerInfo>(
      buyers.map((buyer) => [Number(buyer.id), this.exposeUserSummary(buyer)]),
    );
    const productMap = await this.buildProductMap(
      result.data.flatMap((order) =>
        (order.items ?? []).map((item) =>
          Number((item as { productId: number | string }).productId),
        ),
      ),
    );

    const data = result.data.map((order) => ({
      ...this.exposeOrder({
        ...order,
        items: (order.items ?? []).map((item) =>
          this.decorateItem(item as { productId: number | string }, productMap),
        ),
      }),
      buyer: buyerMap.get(Number(order.userId)) ?? null,
    }));

    const exposedOrders = (await this.exposeUserReferences(data)) as Record<
      string,
      unknown
    >[];
    return PaginatedResponse.of(
      exposedOrders,
      result.total,
      result.page ?? page,
      result.limit ?? limit,
    );
  }

  /**
   * Drop the mutating entries from `availableActions` when the caller cannot
   * invoke them.
   *
   * The orders service computes the list purely from waybill state — it has no
   * idea who is asking. `logistics_operator` holds `shipping read:any` but NOT
   * `shipping update:any`, so without this filter the console is told it may
   * `sync` / `cancel` / `update_cod` an order and every one of those buttons
   * answers 403. Read-only entries always stay.
   */
  private filterShippingActions(
    actions: string[] | undefined,
    canUpdateShipping: boolean,
  ): string[] {
    if (!Array.isArray(actions)) {
      return [];
    }
    if (canUpdateShipping) {
      return actions;
    }
    return actions.filter((action) =>
      (READ_ONLY_SHIPPING_ACTIONS as readonly string[]).includes(action),
    );
  }

  async getAdminGhnOrders(
    query: AdminGhnOrdersQueryDto,
    canUpdateShipping: boolean,
  ): Promise<
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
            timeout(TCP_TIMEOUT_MS.WRITE),
            retryOnTransportError(),
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
    return (await this.exposeUserReferences({
      ...result,
      data: result.data.map((order) => ({
        ...order,
        availableActions: this.filterShippingActions(
          order.availableActions,
          canUpdateShipping,
        ),
        buyer: users.get(Number(order.userId)) ?? null,
        seller: users.get(Number(order.sellerId)) ?? null,
      })),
    })) as Omit<AdminGhnOrderListResult, "data"> & {
      data: (AdminGhnOrderListItem & {
        buyer: UserSummary | null;
        seller: UserSummary | null;
      })[];
    };
  }

  async getAdminGhnOrderDetail(
    orderId: string,
    canUpdateShipping: boolean,
  ): Promise<unknown> {
    try {
      const detail = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_ORDER_DETAIL, { orderId })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as {
        availableActions?: string[];
        localOrder?: {
          userId?: number;
          sellerId?: number;
          items?: OrderItemDetail[];
        };
      };
      const items = detail.localOrder?.items ?? [];
      const productMap = await this.buildProductMap(
        items.map((item) => Number(item.productId)),
      );
      const userIds = [
        detail.localOrder?.userId,
        detail.localOrder?.sellerId,
      ].filter((id): id is number => typeof id === "number");
      const users = await this.getUserSummaryMap(userIds);
      return this.exposeUserReferences({
        ...detail,
        availableActions: this.filterShippingActions(
          detail.availableActions,
          canUpdateShipping,
        ),
        localOrder: detail.localOrder
          ? {
              ...detail.localOrder,
              items: items.map((item) => this.decorateItem(item, productMap)),
            }
          : detail.localOrder,
        buyer:
          detail.localOrder?.userId === undefined
            ? null
            : (users.get(detail.localOrder.userId) ?? null),
        seller:
          detail.localOrder?.sellerId === undefined
            ? null
            : (users.get(detail.localOrder.sellerId) ?? null),
      });
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get admin GHN order detail",
        "Orders Service",
      );
    }
  }

  async syncAdminGhnOrder(
    orderId: string,
    actorId: number | null,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_SYNC, { orderId, actorId })
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
        "sync admin GHN order",
        "Orders Service",
      );
    }
  }

  async getAdminGhnHistory(
    orderId: string,
  ): Promise<Record<string, unknown>[]> {
    try {
      const history = await firstValueFrom(
        this.ordersClient
          .send<
            Record<string, unknown>[]
          >(ORDER_MESSAGE_PATTERN.ADMIN_GHN_HISTORY, { orderId })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            retryOnTransportError(),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
      // `actorId` is the numeric user PK on the way out of the orders service;
      // exposeUserReferences swaps it for the opaque `usr_...` id (PUBID-02),
      // which is what the console shows as "actioned by".
      return (await this.exposeUserReferences(
        history.map((row) => ({ ...row, orderId })),
      )) as Record<string, unknown>[];
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get admin GHN history",
        "Orders Service",
      );
    }
  }

  async cancelAdminGhnOrder(
    orderId: string,
    actorId: number | null,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_CANCEL, { orderId, actorId })
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
        "cancel admin GHN order",
        "Orders Service",
      );
    }
  }

  async returnAdminGhnOrder(
    orderId: string,
    actorId: number | null,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADMIN_GHN_RETURN, { orderId, actorId })
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
        "return admin GHN order",
        "Orders Service",
      );
    }
  }

  async updateAdminGhnCod(
    orderId: string,
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
            timeout(TCP_TIMEOUT_MS.WRITE),
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
    orderId: string,
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
            timeout(TCP_TIMEOUT_MS.WRITE),
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
    orderId: string,
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
            timeout(TCP_TIMEOUT_MS.WRITE),
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
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as UserSummary[];
      // Keys stay numeric (matched against order.userId/sellerId); values are
      // exposed with the opaque public id as `id` (PUBID-02).
      return new Map(
        users.map((user) => [Number(user.id), this.exposeUserSummary(user)]),
      );
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
      const result = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDERS_BY_SELLER, {
            sellerId,
            page: query.page ?? 1,
            limit: query.limit ?? 20,
            status: query.status,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as { data: OrderResponse[] } & Record<string, unknown>;
      const productMap = await this.buildProductMap(
        result.data.flatMap((order) =>
          (order.items ?? []).map((item) =>
            Number((item as { productId: number | string }).productId),
          ),
        ),
      );
      return this.exposeUserReferences({
        ...result,
        data: result.data.map((order) =>
          this.exposeOrder({
            ...order,
            items: (order.items ?? []).map((item) =>
              this.decorateItem(
                item as { productId: number | string },
                productMap,
              ),
            ),
          }),
        ),
      });
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

  /**
   * The global analytics dashboard is gated on `shipping read:any`, which
   * `logistics_operator` holds — that role runs the waybills and needs the
   * volume figures (order counts, status mix, what is moving). It does NOT hold
   * `order read:any`, so it has no business seeing platform revenue. Rather
   * than 403 the whole route (which would take the operational numbers away
   * too), the monetary fields are omitted for callers without that grant;
   * admin and `shipping_manager` get the payload unchanged.
   */
  async getShippingAnalytics(
    query: AnalyticsQueryDto,
    canReadRevenue: boolean,
  ): Promise<unknown> {
    const analytics = await this.fetchAnalytics(
      null,
      query,
      "get shipping analytics",
    );
    return canReadRevenue
      ? analytics
      : this.stripRevenue(analytics as OrderAnalyticsResponse);
  }

  /**
   * Drop every money figure from an analytics payload. Omitted, not zeroed —
   * a `0` is indistinguishable from "we really earned nothing" and the console
   * would render it as fact.
   */
  private stripRevenue(analytics: OrderAnalyticsResponse): unknown {
    if (!analytics || typeof analytics !== "object") {
      return analytics;
    }
    // Rebuilt field-by-field rather than by deletion: an allow-list keeps a
    // money field that upstream adds later from silently reaching a role that
    // is not entitled to it.
    const summary = analytics.summary;
    return {
      ...analytics,
      summary: summary
        ? {
            completedOrders: summary.completedOrders,
            totalOrders: summary.totalOrders,
          }
        : summary,
      revenueOverTime: (analytics.revenueOverTime ?? []).map((point) => ({
        period: point.period,
        orderCount: point.orderCount,
      })),
      topProducts: (analytics.topProducts ?? []).map((product) => ({
        productId: product.productId,
        productName: product.productName,
        quantitySold: product.quantitySold,
      })),
    };
  }

  /**
   * Analytics rows arrive keyed by the numeric product PK. Swap each one for
   * its opaque `prod_` public id before the payload leaves the gateway — it was
   * the last numeric internal id still on this response (PRODTEST-0806 #4).
   * `buildProductMap` degrades to an empty map when the product service is
   * down, so an unresolvable id becomes `null` instead of failing the whole
   * dashboard.
   */
  private async exposeAnalyticsProductIds(
    analytics: unknown,
  ): Promise<unknown> {
    const payload = analytics as OrderAnalyticsResponse | null;
    const topProducts = payload?.topProducts;
    if (!Array.isArray(topProducts) || topProducts.length === 0) {
      return analytics;
    }
    const productMap = await this.buildProductMap(
      topProducts
        .map((product) => Number(product.productId))
        .filter((productId) => Number.isFinite(productId)),
    );
    return {
      ...payload,
      topProducts: topProducts.map((product) => ({
        ...product,
        productId: productMap.get(Number(product.productId))?.publicId ?? null,
      })),
    };
  }

  private async fetchAnalytics(
    sellerId: number | null,
    query: AnalyticsQueryDto,
    operation: string,
  ): Promise<unknown> {
    try {
      const analytics = await firstValueFrom(
        this.ordersClient
          .send<unknown>(ORDER_MESSAGE_PATTERN.ANALYTICS, {
            sellerId,
            from: query.from,
            to: query.to,
            interval: query.interval,
            topN: query.topN,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
      return await this.exposeAnalyticsProductIds(analytics);
    } catch (error) {
      MicroserviceErrorHandler.handleError(error, operation, "Orders Service");
    }
  }

  async confirmOrder(orderId: string, sellerId: number): Promise<unknown> {
    try {
      const order = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.CONFIRM_ORDER, { orderId, sellerId })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as OrderResponse;
      return this.exposeOrderWithProducts(order);
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "confirm order",
        "Orders Service",
      );
    }
  }

  async readyToShip(orderId: string, sellerId: number): Promise<unknown> {
    try {
      const order = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.READY_TO_SHIP, { orderId, sellerId })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as OrderResponse;
      return this.exposeOrderWithProducts(order);
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
    orderId: string,
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
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
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

    return this.exposeUserReferences(
      this.exposeOrder({
        ...order,
        shippingFee: Number(order.shippingFee ?? 0),
        subtotal: this.computeSubtotal(items),
        items: enrichedItems,
      }),
    );
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
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
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
      productPublicId?: string | null;
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
      productId: item.productPublicId ?? product?.publicId ?? null,
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
    orderId: string,
    sellerId: number,
    isAdmin: boolean,
    targetStatus: string,
  ): Promise<unknown> {
    try {
      const order = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.ADVANCE_ORDER_STATUS, {
            orderId,
            sellerId,
            isAdmin,
            targetStatus,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as OrderResponse;
      return this.exposeOrderWithProducts(order);
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
    orderId: string,
    userId: number,
    reason: string,
  ): Promise<unknown> {
    try {
      const request = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.RETURN_REQUEST_CREATE, {
            orderId,
            userId,
            reason,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as Record<string, unknown> & {
        orderId?: number | string;
        orderPublicId?: string | null;
      };
      return this.exposeUserReferences(this.exposeReturnRequest(request));
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
      const result = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.RETURN_REQUEST_LIST_USER, {
            userId,
            page,
            limit,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as {
        data: (Record<string, unknown> & {
          orderId?: number | string;
          orderPublicId?: string | null;
        })[];
      } & Record<string, unknown>;
      return this.exposeUserReferences({
        ...result,
        data: result.data.map((row) => this.exposeReturnRequest(row)),
      });
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
      const result = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.RETURN_REQUEST_LIST_MANAGED, {
            sellerId,
            isAdmin,
            page,
            limit,
            status,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as {
        data: (Record<string, unknown> & {
          orderId?: number | string;
          orderPublicId?: string | null;
        })[];
      } & Record<string, unknown>;
      return this.exposeUserReferences({
        ...result,
        data: result.data.map((row) => this.exposeReturnRequest(row)),
      });
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "list managed return requests",
        "Orders Service",
      );
    }
  }

  async reviewReturnRequest(
    requestId: string,
    reviewerId: number,
    reviewerRole: string,
    decision: "approve" | "reject",
    rejectReason?: string,
  ): Promise<unknown> {
    try {
      const request = (await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.RETURN_REQUEST_REVIEW, {
            requestId,
            reviewerId,
            reviewerRole,
            decision,
            rejectReason,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      )) as Record<string, unknown> & {
        orderId?: number | string;
        orderPublicId?: string | null;
      };
      return this.exposeUserReferences(this.exposeReturnRequest(request));
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "review return request",
        "Orders Service",
      );
    }
  }
}
