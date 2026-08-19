import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  Brackets,
  EntityManager,
  In,
  IsNull,
  LessThan,
  Like,
  QueryFailedError,
  Repository,
} from "typeorm";
import { Order, OrderStatus } from "./entity/order.entity";
import { OrderOutbox } from "./entity/order-outbox.entity";
import {
  PaymentMethod,
  PaginatedResponse,
  generatePublicId,
  isPublicId,
  isRmqPublisherLive,
} from "@app/common";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";
import { CachedService } from "@app/cached";
import { HttpService } from "@nestjs/axios";
import { ClientProxy } from "@nestjs/microservices";
import { catchError, firstValueFrom, throwError, timeout } from "rxjs";
import { OrderItem } from "./entity/order_item.entity";
import { CartItem } from "./entity/cart-item.entity";
import { EVENT } from "@app/common/constants/event";
import { EXCHANGE } from "@app/common/constants/exchange";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { USER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { PRODUCT_MESSAGE_PATTERNS } from "libs/constant/message-pattern-product.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { isGhnStatusWithoutLocalStatus } from "libs/constant/shipping.constant";
import { generateInvoicePdf, InvoiceParty } from "./invoice/invoice.generator";
import { GhnService } from "./ghn/ghn.service";
import {
  GhnOrderDetail,
  GhnReceiverUpdate,
  GhnResolvedAddress,
  GhnShippingItem,
  ShippingFeePreview,
} from "./ghn/ghn.types";
import { Channel } from "amqplib";
import { randomUUID } from "crypto";
import {
  ShippingHistory,
  ShippingHistoryType,
  ShippingPayloadSummary,
} from "./entity/shipping-history.entity";
import {
  OrderReturnRequest,
  RefundStatus,
  ReturnRequestStatus,
} from "./entity/order-return-request.entity";
import { Voucher, VoucherDiscountType } from "./entity/voucher.entity";
import { VoucherRedemption } from "./entity/voucher-redemption.entity";
import {
  ORDER_MESSAGE,
  VOUCHER_MESSAGE,
} from "libs/constant/response-message.constant";
import {
  StockReservationItem,
  AdminGhnOrderListQuery,
  AdminGhnOrderListItem,
  AdminGhnOrderDetail,
  AdminGhnSyncResult,
  AnalyticsQuery,
  RevenuePoint,
  TopProduct,
  OrderAnalytics,
  AdminGhnActionType,
  AdminGhnActionResult,
  AdminGhnUpdateCodResult,
  AdminGhnReceiverUpdateInput,
  AdminGhnUpdateReceiverResult,
  GhnStatusApplyResult,
  ReturnRequestView,
} from "./orders.types";

/**
 * Neutralize the SQL LIKE wildcards in user input so a buyer typing `_` or `%`
 * in the order-code search box gets a literal match instead of a wildcard scan.
 * MySQL's default LIKE escape character is a backslash, so no ESCAPE clause is
 * needed (TypeORM's `Like()` does not emit one).
 */
const escapeLikeTerm = (term: string): string =>
  term.replace(/[\\%_]/g, (character) => `\\${character}`);

/** How many owed events one outbox tick drains before yielding (RESIL-02). */
const ORDER_OUTBOX_BATCH_SIZE = 50;

/** How long a delivered outbox row is kept as an audit trail before pruning. */
const ORDER_OUTBOX_RETENTION_DAYS = 7;

/** How many abandoned orders one stale-reservation sweep tick cancels. */
const ORDER_STALE_SWEEP_BATCH_SIZE = 25;

/** Redis key prefix for the remaining-redemptions counter of a capped voucher. */
const VOUCHER_QUOTA_KEY_PREFIX = "voucher:quota:";

/**
 * How long the Redis mirror of a voucher's remaining redemptions lives.
 * Short on purpose: SQL is the source of truth, so the counter only has to
 * outlive a burst. Every lapse re-seeds it from `usage_limit - used_count`,
 * which erases any drift a failed refund left behind (VOUCHER-CONC-01).
 */
const VOUCHER_QUOTA_TTL_SECONDS = 300;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel | null,
    private readonly httpService: HttpService,
    @Inject(NAME_SERVICE_TCP.INVENTORY_SERVICE)
    private readonly inventoryClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.PRODUCT_SERVICE)
    private readonly productClient: ClientProxy,
    // @Inject("PAYMENTS_SERVICE") private readonly paymentClient: ClientProxy,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(OrderOutbox)
    private readonly outboxRepository: Repository<OrderOutbox>,
    @InjectRepository(ShippingHistory)
    private readonly shippingHistoryRepository: Repository<ShippingHistory>,
    @InjectRepository(OrderReturnRequest)
    private readonly returnRequestRepository: Repository<OrderReturnRequest>,
    @InjectRepository(Voucher)
    private readonly voucherRepository: Repository<Voucher>,
    @InjectRepository(VoucherRedemption)
    private readonly voucherRedemptionRepository: Repository<VoucherRedemption>,
    private readonly ghnService: GhnService,
    private readonly cachedService: CachedService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Warm the outbound TCP sockets so the first checkout does not pay the
    // connect cost. Best-effort by design: a peer that is not listening YET
    // (parallel boot, rolling restart, pm2 starting all 10 apps at once) must
    // not take this service down — ClientProxy reconnects lazily on the first
    // send anyway. This matters since RESIL-02 added the missing app.init():
    // before it, this hook never ran at all, so an unhandled ECONNREFUSED here
    // would be a brand-new crash-on-boot with a mutual product<->orders
    // deadlock (each refuses to start while the other is down).
    await Promise.all([
      this.warmTcpClient("inventory", this.inventoryClient),
      this.warmTcpClient("user", this.userClient),
      this.warmTcpClient("product", this.productClient),
    ]);
  }

  private async warmTcpClient(
    serviceName: string,
    client: ClientProxy,
  ): Promise<void> {
    try {
      await client.connect();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "unknown transport error";
      this.logger.warn(
        `Could not pre-connect to the ${serviceName} service (${message}) — connecting lazily on the first call instead.`,
      );
    }
  }

  async placeOrder(
    userId: number,
    paymentMethod: PaymentMethod,
    shippingAddress: string,
    items: Array<{
      productId: number;
      productPublicId?: string | null;
      productName: string;
      quantity: number;
      price: number;
      sellerId?: number;
      skuId?: number | null;
      tierIdx?: number[];
      weight?: number;
      productImage?: string | null;
      skuLabel?: string | null;
    }>,
    voucherCode?: string | null,
    ghnAddress?: GhnResolvedAddress,
  ): Promise<Order> {
    // Single-seller path: gateway enriches every item with the same sellerId
    const sellerId = items[0]?.sellerId;
    if (!sellerId) {
      throw new BadRequestException(ORDER_MESSAGE.ITEMS_MISSING_SELLER_ID);
    }
    // 1. Check stock in inventory for all items
    for (const item of items) {
      const result = await firstValueFrom(
        this.inventoryClient
          .send<{
            available: boolean;
            availableStock: number;
          }>(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK, {
            productId: item.productId,
            quantity: item.quantity,
            skuId: item.skuId ?? undefined,
          })
          .pipe(
            timeout(5000),
            catchError((e: unknown) => throwError(() => e)),
          ),
      );
      if (!result.available) {
        throw new BadRequestException(
          ORDER_MESSAGE.INSUFFICIENT_STOCK(
            item.productId,
            item.quantity,
            result.availableStock,
          ),
        );
      }
    }
    const itemsTotal = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    // F3: validate + price the voucher (if any) against the goods subtotal
    // before reserving stock so an invalid code fails fast. The redemption is
    // consumed atomically inside the create transaction below.
    const voucherResult = voucherCode
      ? await this.validateVoucherForCheckout(userId, voucherCode, itemsTotal)
      : null;
    const discountAmount = voucherResult?.discountAmount ?? 0;
    // VOUCHER-CONC-01: take the quota slot HERE — before the GHN round trip and
    // before any stock is reserved. On a flash voucher the DB cap alone rejects
    // the losers only at the very end, after each of them has already burnt an
    // outbound GHN call and a reservation that then has to be compensated. The
    // Redis counter turns that into a rejection that costs one round trip.
    const hasClaimedVoucherQuota = voucherResult
      ? await this.claimVoucherQuota(voucherResult.voucher)
      : false;

    let order: Order;
    let outboxRow: OrderOutbox;
    let reservedKey: string | null = null;
    try {
      // Shipping fee from GHN preview is added to the order total so the
      // payment (COD or gateway) charges goods + shipping in one amount
      const shippingFee = await this.getShippingFeeOrZero(
        shippingAddress,
        paymentMethod === PaymentMethod.COD ? itemsTotal : 0,
        items,
        ghnAddress,
      );
      // Discount applies to goods only — never to shipping — and can never drive
      // the total below the shipping fee.
      const total = itemsTotal - discountAmount + shippingFee;
      const reservationKey = randomUUID();
      await this.reserveOrderItems(items, reservationKey);
      // Only from here on is there a reservation to compensate: a failing
      // reserve already rolls back its own partial holds.
      reservedKey = reservationKey;
      const created = await this.orderRepository.manager.transaction(
        async (manager) => {
          const savedOrder = await manager.save(
            manager.create(Order, {
              publicId: generatePublicId(PUBLIC_ID_PREFIXES.ORDER),
              userId,
              sellerId,
              total,
              paymentMethod,
              shippingAddress,
              shippingFee,
              codAmount: paymentMethod === PaymentMethod.COD ? total : null,
              reservationKey,
              toDistrictId: ghnAddress?.districtId ?? null,
              toWardCode: ghnAddress?.wardCode ?? null,
              voucherCode: voucherResult ? voucherResult.voucher.code : null,
              discountAmount: voucherResult ? discountAmount : null,
            }),
          );
          const orderItems = items.map((item) =>
            manager.create(OrderItem, {
              ...item,
              orderId: savedOrder.id,
              skuId: item.skuId ?? null,
              skuTierIdx: Array.isArray(item.tierIdx)
                ? JSON.stringify(item.tierIdx)
                : null,
            }),
          );
          await manager.save(OrderItem, orderItems);
          savedOrder.items = orderItems;
          // RESIL-02: the event commits with the order, so a broker outage can
          // no longer leave a live order that nobody downstream heard about.
          const outbox = await this.enqueueOrderCreatedEvent(
            manager,
            savedOrder,
          );
          // VOUCHER-CONC-01: redeem LAST. The conditional UPDATE below takes an
          // exclusive row lock on the voucher that every concurrent checkout of
          // the same code queues behind, and the lock is only released at
          // commit — so on a hot code this statement's position decides the
          // whole endpoint's throughput. Keep it the last thing before commit;
          // it used to also span the order-items and outbox inserts.
          if (voucherResult) {
            await this.redeemVoucher(
              manager,
              voucherResult.voucher,
              userId,
              savedOrder.id,
              discountAmount,
            );
          }
          return { savedOrder, outbox };
        },
      );
      order = created.savedOrder;
      outboxRow = created.outbox;
    } catch (error) {
      if (reservedKey) {
        await this.releaseReservedItems(items, reservedKey);
      }
      if (hasClaimedVoucherQuota && voucherResult) {
        await this.releaseVoucherQuota(voucherResult.voucher.id);
      }
      throw error;
    }

    const isPublished = await this.tryPublishOutboxRow(outboxRow);
    if (!isPublished && order.paymentMethod !== PaymentMethod.COD) {
      // An online payment needs the downstream leg NOW — the client asks for
      // `paymentUrl` immediately after this call, so a poller retry 30s later
      // is not good enough. Cancel and drop the owed event with it.
      await this.discardOutboxRow(outboxRow.id);
      await this.cancelOrderAfterPaymentInitializationFailure(order);
      throw new ServiceUnavailableException(
        ORDER_MESSAGE.PAYMENT_INIT_UNAVAILABLE,
      );
    }

    if (order.paymentMethod === PaymentMethod.COD) {
      try {
        const ghnCode = await this.ghnService.createShippingOrder(order);
        await this.orderRepository.update(order.id, {
          ghnOrderCode: ghnCode,
        });
        order.ghnOrderCode = ghnCode;
      } catch (err) {
        this.logger.error(
          `GHN createShippingOrder failed for order ${order.id}: ${err}`,
        );
        // order already saved — return without ghnOrderCode, retry later
      }
    }

    return order;
  }

  // ---------------------------------------------------------------------------
  // F3: Vouchers / discount codes
  // ---------------------------------------------------------------------------

  private normalizeVoucherCode(code: string): string {
    return code.trim().toUpperCase();
  }

  /**
   * Validate a voucher against a goods subtotal and compute the discount. This
   * is a pure read — it does NOT consume usage. Throws on any rule violation so
   * the caller surfaces a clear 400/404.
   */
  private async validateVoucherForCheckout(
    userId: number,
    rawCode: string,
    itemsTotal: number,
  ): Promise<{ voucher: Voucher; discountAmount: number }> {
    const code = this.normalizeVoucherCode(rawCode);
    const voucher = await this.voucherRepository.findOne({ where: { code } });
    if (!voucher || !voucher.isActive) {
      throw new NotFoundException(VOUCHER_MESSAGE.NOT_FOUND_OR_INACTIVE(code));
    }
    const now = new Date();
    if (voucher.startsAt && now < voucher.startsAt) {
      throw new BadRequestException(VOUCHER_MESSAGE.NOT_ACTIVE_YET(code));
    }
    if (voucher.expiresAt && now > voucher.expiresAt) {
      throw new BadRequestException(VOUCHER_MESSAGE.EXPIRED(code));
    }
    const minOrder = Number(voucher.minOrderAmount ?? 0);
    if (itemsTotal < minOrder) {
      throw new BadRequestException(
        VOUCHER_MESSAGE.MIN_ORDER_NOT_MET(minOrder, code),
      );
    }
    if (
      voucher.usageLimit !== null &&
      voucher.usedCount >= voucher.usageLimit
    ) {
      throw new BadRequestException(VOUCHER_MESSAGE.FULLY_REDEEMED(code));
    }
    if (voucher.perUserLimit !== null) {
      const usedByUser = await this.voucherRedemptionRepository.count({
        where: { voucherId: voucher.id, userId },
      });
      if (usedByUser >= voucher.perUserLimit) {
        throw new BadRequestException(VOUCHER_MESSAGE.USER_LIMIT_REACHED(code));
      }
    }
    const discountAmount = this.computeDiscount(voucher, itemsTotal);
    if (discountAmount <= 0) {
      throw new BadRequestException(VOUCHER_MESSAGE.NO_DISCOUNT(code));
    }
    return { voucher, discountAmount };
  }

  /**
   * Compute the VND discount for a voucher against a goods subtotal. Percentage
   * vouchers honour an optional cap; the result is always clamped to the
   * subtotal so the order total can never go negative.
   */
  private computeDiscount(voucher: Voucher, itemsTotal: number): number {
    const value = Number(voucher.discountValue ?? 0);
    let discount: number;
    if (voucher.discountType === VoucherDiscountType.PERCENT) {
      discount = (itemsTotal * value) / 100;
      const cap =
        voucher.maxDiscountAmount !== null
          ? Number(voucher.maxDiscountAmount)
          : null;
      if (cap !== null && discount > cap) {
        discount = cap;
      }
    } else {
      discount = value;
    }
    discount = Math.min(discount, itemsTotal);
    return Math.round(discount);
  }

  /**
   * Consume one redemption of the voucher inside the order-create transaction.
   * The conditional UPDATE makes the usage cap atomic: if the cap was hit by a
   * concurrent order between validation and here, zero rows change and we abort
   * (rolling the order back, which releases the reserved stock).
   */
  private async redeemVoucher(
    manager: EntityManager,
    voucher: Voucher,
    userId: number,
    orderId: number,
    discountAmount: number,
  ): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .update(Voucher)
      .set({ usedCount: () => "used_count + 1" })
      .where("id = :id", { id: voucher.id })
      .andWhere("(usage_limit IS NULL OR used_count < usage_limit)")
      .execute();
    if (!result.affected) {
      throw new ConflictException(
        VOUCHER_MESSAGE.JUST_FULLY_REDEEMED(voucher.code),
      );
    }
    // The UPDATE above holds the voucher row exclusively until commit, so every
    // concurrent redemption of this code is serialized from here on. That makes
    // this the only place the per-user limit can be counted honestly: the same
    // count in `validateVoucherForCheckout` is a check-then-act that two
    // requests from one buyer both pass (two tabs → two idempotency keys → two
    // orders on a one-per-user code). Throwing here rolls the increment back
    // with the order.
    //
    // It has to be a LOCKING read: under REPEATABLE READ a plain SELECT answers
    // from the snapshot this transaction took before the UPDATE, which does not
    // include the row the transaction we just queued behind has since
    // committed. `FOR UPDATE` reads the latest committed version instead. The
    // lock order (voucher row first, redemptions second) is the same in every
    // caller, so this cannot deadlock. Served by
    // idx_voucher_redemptions_voucher_user.
    if (voucher.perUserLimit !== null) {
      const redemptionsByUser = await manager.find(VoucherRedemption, {
        where: { voucherId: voucher.id, userId },
        select: { id: true },
        lock: { mode: "pessimistic_write" },
      });
      if (redemptionsByUser.length >= voucher.perUserLimit) {
        throw new BadRequestException(
          VOUCHER_MESSAGE.USER_LIMIT_REACHED(voucher.code),
        );
      }
    }
    await manager.save(
      manager.create(VoucherRedemption, {
        voucherId: voucher.id,
        userId,
        orderId,
        discountAmount: discountAmount.toFixed(2),
      }),
    );
  }

  /**
   * Admission gate in front of a capped voucher (VOUCHER-CONC-01).
   *
   * Returns true when a slot was taken and the caller therefore owes a
   * {@link releaseVoucherQuota} if the checkout does not commit. Uncapped
   * vouchers claim nothing. Throws 409 — the same status the DB-level loser
   * gets today — when the quota is already gone.
   *
   * Fails OPEN: if Redis is unreachable the checkout proceeds and the
   * conditional UPDATE in {@link redeemVoucher} still enforces the cap. This
   * counter is an optimization, never the source of truth, so a Redis outage
   * must cost throughput, not correctness.
   */
  private async claimVoucherQuota(voucher: Voucher): Promise<boolean> {
    if (voucher.usageLimit === null) {
      return false;
    }
    const remainingInSql = Math.max(voucher.usageLimit - voucher.usedCount, 0);
    try {
      const remaining = await this.cachedService.claimFromSeededQuota(
        `${VOUCHER_QUOTA_KEY_PREFIX}${voucher.id}`,
        remainingInSql,
        VOUCHER_QUOTA_TTL_SECONDS,
      );
      if (remaining < 0) {
        throw new ConflictException(
          VOUCHER_MESSAGE.JUST_FULLY_REDEEMED(voucher.code),
        );
      }
      return true;
    } catch (error: unknown) {
      if (error instanceof ConflictException) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "unknown cache error";
      this.logger.warn(
        `Voucher quota gate unavailable for ${voucher.code} (${message}) — falling through to the database cap.`,
      );
      return false;
    }
  }

  /**
   * Hand a claimed slot back when the checkout it was covering failed. Best
   * effort: a lost refund only makes the mirror pessimistic (a few buyers get a
   * 409 on a code that still has room) until the TTL re-seeds it from SQL.
   */
  private async releaseVoucherQuota(voucherId: number): Promise<void> {
    try {
      await this.cachedService.releaseToSeededQuota(
        `${VOUCHER_QUOTA_KEY_PREFIX}${voucherId}`,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "unknown cache error";
      this.logger.warn(
        `Could not return the quota slot of voucher ${voucherId} (${message}) — it self-heals when the counter expires.`,
      );
    }
  }

  /**
   * Buyer-facing preview: validate a code against a goods subtotal and return
   * the discount it would produce, without consuming a redemption.
   */
  async previewVoucher(
    userId: number,
    code: string,
    itemsTotal: number,
  ): Promise<{
    code: string;
    discountType: VoucherDiscountType;
    discountAmount: number;
    itemsTotal: number;
    finalItemsTotal: number;
  }> {
    const { voucher, discountAmount } = await this.validateVoucherForCheckout(
      userId,
      code,
      itemsTotal,
    );
    return {
      code: voucher.code,
      discountType: voucher.discountType,
      discountAmount,
      itemsTotal,
      finalItemsTotal: itemsTotal - discountAmount,
    };
  }

  async createVoucher(input: {
    code: string;
    description?: string | null;
    discountType: VoucherDiscountType;
    discountValue: number;
    minOrderAmount?: number;
    maxDiscountAmount?: number | null;
    usageLimit?: number | null;
    perUserLimit?: number | null;
    startsAt?: string | null;
    expiresAt?: string | null;
    isActive?: boolean;
  }): Promise<Voucher> {
    const code = this.normalizeVoucherCode(input.code);
    const existing = await this.voucherRepository.findOne({ where: { code } });
    if (existing) {
      throw new ConflictException(VOUCHER_MESSAGE.ALREADY_EXISTS(code));
    }
    if (
      input.discountType === VoucherDiscountType.PERCENT &&
      (input.discountValue <= 0 || input.discountValue > 100)
    ) {
      throw new BadRequestException(VOUCHER_MESSAGE.PERCENT_VALUE_INVALID);
    }
    if (
      input.discountType === VoucherDiscountType.FIXED &&
      input.discountValue <= 0
    ) {
      throw new BadRequestException(VOUCHER_MESSAGE.FIXED_VALUE_INVALID);
    }
    const voucher = this.voucherRepository.create({
      code,
      description: input.description ?? null,
      discountType: input.discountType,
      discountValue: input.discountValue.toFixed(2),
      minOrderAmount: (input.minOrderAmount ?? 0).toFixed(2),
      maxDiscountAmount:
        input.maxDiscountAmount != null
          ? input.maxDiscountAmount.toFixed(2)
          : null,
      usageLimit: input.usageLimit ?? null,
      perUserLimit: input.perUserLimit ?? null,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      isActive: input.isActive ?? true,
    });
    try {
      return await this.voucherRepository.save(voucher);
    } catch (error: unknown) {
      // The `existing` lookup above is a check-then-act; uq_vouchers_code is
      // what actually stops two admins creating the same code at once. Map its
      // collision to the same 409 the lookup would have produced instead of
      // leaking a driver error as a 500.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === "ER_DUP_ENTRY"
      ) {
        throw new ConflictException(VOUCHER_MESSAGE.ALREADY_EXISTS(code));
      }
      throw error;
    }
  }

  async listVouchers(
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<Voucher>> {
    const [data, total] = await this.voucherRepository.findAndCount({
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return PaginatedResponse.of(data, total, page, limit);
  }

  async deactivateVoucher(id: number): Promise<Voucher> {
    const voucher = await this.voucherRepository.findOne({ where: { id } });
    if (!voucher) {
      throw new NotFoundException(VOUCHER_MESSAGE.NOT_FOUND_BY_ID(id));
    }
    voucher.isActive = false;
    return this.voucherRepository.save(voucher);
  }

  async placeMultiSellerOrder(
    userId: number,
    paymentMethod: PaymentMethod,
    shippingAddress: string,
    items: Array<{
      productId: number;
      productPublicId?: string | null;
      productName: string;
      quantity: number;
      price: number;
      sellerId: number;
      skuId?: number | null;
      tierIdx?: number[];
      weight?: number;
      productImage?: string | null;
      skuLabel?: string | null;
    }>,
    ghnAddress?: GhnResolvedAddress,
  ): Promise<Order[]> {
    // Check stock in inventory for all items before creating any order
    for (const item of items) {
      const result = await firstValueFrom(
        this.inventoryClient
          .send<{
            available: boolean;
            availableStock: number;
          }>(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK, {
            productId: item.productId,
            quantity: item.quantity,
            skuId: item.skuId ?? undefined,
          })
          .pipe(
            timeout(5000),
            catchError((e: unknown) => throwError(() => e)),
          ),
      );
      if (!result.available) {
        throw new BadRequestException(
          ORDER_MESSAGE.INSUFFICIENT_STOCK(
            item.productId,
            item.quantity,
            result.availableStock,
          ),
        );
      }
    }

    type SellerItem = (typeof items)[number];
    const grouped = items.reduce<Map<number, SellerItem[]>>((acc, item) => {
      const bucket = acc.get(item.sellerId) ?? [];
      bucket.push(item);
      acc.set(item.sellerId, bucket);
      return acc;
    }, new Map());
    const sellerIds = [...grouped.keys()];

    // Each seller group ships separately → one GHN fee per child order.
    // Computed before the transaction so external HTTP calls never hold a DB lock.
    const shippingFeeBySeller = new Map<number, number>();
    for (const sellerId of sellerIds) {
      const sellerItems = grouped.get(sellerId) ?? [];
      const sellerItemsTotal = sellerItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0,
      );
      const fee = await this.getShippingFeeOrZero(
        shippingAddress,
        paymentMethod === PaymentMethod.COD ? sellerItemsTotal : 0,
        sellerItems,
        ghnAddress,
      );
      shippingFeeBySeller.set(sellerId, fee);
    }

    const reservationKeyBySeller = new Map(
      sellerIds.map((sellerId) => [sellerId, randomUUID()]),
    );
    const reservedSellerIds: number[] = [];
    try {
      for (const sellerId of sellerIds) {
        await this.reserveOrderItems(
          grouped.get(sellerId) ?? [],
          reservationKeyBySeller.get(sellerId) as string,
        );
        reservedSellerIds.push(sellerId);
      }
    } catch (error) {
      for (const sellerId of reservedSellerIds.reverse()) {
        await this.releaseReservedItems(
          grouped.get(sellerId) ?? [],
          reservationKeyBySeller.get(sellerId) as string,
        );
      }
      throw error;
    }

    const createdOrders: Order[] = [];
    const outboxRowByOrderId = new Map<number, OrderOutbox>();

    try {
      await this.orderRepository.manager.transaction(async (manager) => {
        for (const sellerId of sellerIds) {
          const sellerItems = grouped.get(sellerId) ?? [];
          const shippingFee = shippingFeeBySeller.get(sellerId) ?? 0;
          const total =
            sellerItems.reduce(
              (sum, item) => sum + item.price * item.quantity,
              0,
            ) + shippingFee;

          const order = await manager.save(
            manager.create(Order, {
              publicId: generatePublicId(PUBLIC_ID_PREFIXES.ORDER),
              userId,
              sellerId,
              total,
              paymentMethod,
              shippingAddress,
              shippingFee,
              codAmount: paymentMethod === PaymentMethod.COD ? total : null,
              reservationKey: reservationKeyBySeller.get(sellerId),
              toDistrictId: ghnAddress?.districtId ?? null,
              toWardCode: ghnAddress?.wardCode ?? null,
            }),
          );

          const orderItems = sellerItems.map((item) =>
            manager.create(OrderItem, {
              orderId: order.id,
              productId: item.productId,
              productPublicId: item.productPublicId ?? null,
              productName: item.productName,
              quantity: item.quantity,
              price: item.price,
              sellerId,
              skuId: item.skuId ?? null,
              skuTierIdx: Array.isArray(item.tierIdx)
                ? JSON.stringify(item.tierIdx)
                : null,
              skuLabel: item.skuLabel ?? null,
              weight: item.weight ?? null,
              productImage: item.productImage ?? null,
            }),
          );
          await manager.save(OrderItem, orderItems);

          order.items = orderItems;
          // RESIL-02: same durability as the single-seller path — previously
          // this leg only warned on a broker outage, for EVERY payment method.
          outboxRowByOrderId.set(
            order.id,
            await this.enqueueOrderCreatedEvent(manager, order, {
              isMultiSellerCheckout: true,
            }),
          );
          createdOrders.push(order);
        }
      });
    } catch (error) {
      for (const sellerId of sellerIds) {
        await this.releaseReservedItems(
          grouped.get(sellerId) ?? [],
          reservationKeyBySeller.get(sellerId) as string,
        );
      }
      throw error;
    }

    // Emit ORDER_CREATED_EVENT per sub-order after transaction commits. A
    // failure here is no longer terminal: the row stays in the outbox and the
    // poller delivers it.
    for (const order of createdOrders) {
      const outboxRow = outboxRowByOrderId.get(order.id);
      if (outboxRow) {
        await this.tryPublishOutboxRow(outboxRow);
      }

      if (paymentMethod === PaymentMethod.COD) {
        try {
          const ghnCode = await this.ghnService.createShippingOrder(order);
          await this.orderRepository.update(order.id, {
            ghnOrderCode: ghnCode,
          });
          order.ghnOrderCode = ghnCode;
        } catch (err) {
          this.logger.error(
            `[ORDERS] GHN createShippingOrder failed for order ${order.id}: ${err}`,
          );
        }
      }
    }

    return createdOrders;
  }

  private async reserveOrderItems(
    items: StockReservationItem[],
    reservationKey: string,
  ): Promise<void> {
    const reservedItems: StockReservationItem[] = [];
    try {
      for (const item of items) {
        const reserved = await firstValueFrom(
          this.inventoryClient
            .send<boolean>(INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESERVE_STOCK, {
              productId: item.productId,
              quantity: item.quantity,
              skuId: item.skuId ?? undefined,
              reservationKey,
            })
            .pipe(
              timeout(5000),
              catchError((e: unknown) => throwError(() => e)),
            ),
        );
        if (!reserved) {
          throw new BadRequestException(
            ORDER_MESSAGE.RESERVE_STOCK_FAILED(item.productId),
          );
        }
        reservedItems.push(item);
      }
    } catch (error) {
      await this.releaseReservedItems(reservedItems, reservationKey);
      throw error;
    }
  }

  private buildOrderCreatedEnvelope(
    order: Order,
    extraData: Record<string, unknown> = {},
  ): string {
    return JSON.stringify({
      pattern: EVENT.ORDER_CREATED_EVENT,
      data: {
        ...order,
        paymentMethod: order.paymentMethod,
        ...extraData,
      },
    });
  }

  /**
   * Record the event in the outbox using the CALLER's transaction manager, so
   * the order and the event it owes commit together (RESIL-02). Returns the
   * saved row so the post-commit publish can mark it delivered.
   */
  private async enqueueOrderCreatedEvent(
    manager: EntityManager,
    order: Order,
    extraData: Record<string, unknown> = {},
  ): Promise<OrderOutbox> {
    return manager.save(
      manager.create(OrderOutbox, {
        eventName: EVENT.ORDER_CREATED_EVENT,
        exchange: EXCHANGE.ORDERS_EXCHANGE,
        orderId: order.id,
        payload: this.buildOrderCreatedEnvelope(order, extraData),
      }),
    );
  }

  /**
   * The injected channel is the self-healing proxy from
   * `RmqModule.registerDirectPublisher()`: while the broker is down it keeps
   * answering `publish()` with a no-op that returns `false`, and every other
   * property with `undefined`. So `connection` is the only honest liveness
   * signal — without checking it, an outage would mark every outbox row
   * published and lose exactly the events this table exists to protect.
   *
   * Every publish site in this service goes through it (OUTBOX-SCOPE-01): the
   * non-outbox events are still best-effort, but an outage now produces a
   * warn naming the dropped event instead of a silent no-op.
   */
  private isFanoutChannelLive(): boolean {
    return isRmqPublisherLive(this.fanoutChannel);
  }

  /**
   * Publish an outbox row and mark it delivered. Throws if the broker is
   * unavailable — the row then stays pending for `drainOrderOutbox()`.
   */
  private async publishOutboxRow(
    id: number,
    exchange: string,
    eventName: string,
    payload: string,
  ): Promise<void> {
    if (!this.fanoutChannel || !this.isFanoutChannelLive()) {
      throw new ServiceUnavailableException(
        ORDER_MESSAGE.RMQ_PUBLISHER_UNAVAILABLE,
      );
    }
    const isWritten = this.fanoutChannel.publish(
      exchange,
      eventName,
      Buffer.from(payload),
    );
    if (!isWritten) {
      // The channel is live, so this is amqplib back-pressure only: the frame
      // is buffered and still goes out. Retrying would duplicate the event.
      this.logger.warn(
        `[ORDERS] ${eventName} for order ${id} buffered by amqplib back-pressure`,
      );
    }
    await this.outboxRepository.update(id, {
      publishedAt: new Date(),
      lastError: null,
    });
  }

  /**
   * Best-effort immediate delivery. A failure is NOT fatal: the row is still
   * in the outbox, so the poller will deliver it. Returns whether it went out,
   * because the single-seller online-payment path has to react synchronously.
   */
  private async tryPublishOutboxRow(row: OrderOutbox): Promise<boolean> {
    try {
      await this.publishOutboxRow(
        row.id,
        row.exchange,
        row.eventName,
        row.payload,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.outboxRepository.update(row.id, {
        attempts: 1,
        lastError: message.slice(0, 500),
      });
      this.logger.warn(
        `[ORDERS] ${row.eventName} not published inline for order ${row.orderId} — left in the outbox for the poller: ${message}`,
      );
      return false;
    }
  }

  /**
   * Drop an owed event whose order is being canceled in the same breath, so the
   * poller cannot resurrect `order_created` for an order that no longer exists
   * as far as the buyer is concerned.
   */
  private async discardOutboxRow(id: number): Promise<void> {
    try {
      await this.outboxRepository.delete(id);
    } catch (error) {
      this.logger.error(
        `[ORDERS] Failed to discard outbox row ${id}: ${String(error)}`,
      );
    }
  }

  /**
   * Drain whatever the inline publish could not deliver. Runs on every orders
   * instance; consumers are idempotent by `orderId`/`reservationKey`, so a
   * double delivery after a crash between publish and mark is harmless — a
   * lost event is not, which is the failure this exists to prevent.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async drainOrderOutbox(): Promise<void> {
    if (!this.isFanoutChannelLive()) return;
    const pending = await this.outboxRepository.find({
      where: { publishedAt: IsNull() },
      order: { id: "ASC" },
      take: ORDER_OUTBOX_BATCH_SIZE,
    });
    if (pending.length === 0) return;

    for (const row of pending) {
      try {
        await this.publishOutboxRow(
          row.id,
          row.exchange,
          row.eventName,
          row.payload,
        );
        this.logger.log(
          `[ORDERS] Outbox delivered ${row.eventName} for order ${row.orderId} after ${row.attempts} failed attempt(s)`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.outboxRepository.update(row.id, {
          attempts: row.attempts + 1,
          lastError: message.slice(0, 500),
        });
        this.logger.error(
          `[ORDERS] Outbox delivery failed for ${row.eventName} order ${row.orderId} (attempt ${row.attempts + 1}): ${message}`,
        );
        // The broker is down for this whole tick — stop hammering it.
        return;
      }
    }
  }

  /**
   * Keep the table from growing forever. Delivered rows are only kept as a
   * short audit trail; anything still pending is never touched.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneOrderOutbox(): Promise<void> {
    const cutoff = new Date(
      Date.now() - ORDER_OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const result = await this.outboxRepository.delete({
      publishedAt: LessThan(cutoff),
    });
    if (result.affected) {
      this.logger.log(
        `[ORDERS] Pruned ${result.affected} delivered outbox row(s) older than ${ORDER_OUTBOX_RETENTION_DAYS}d`,
      );
    }
  }

  private async cancelOrderAfterPaymentInitializationFailure(
    order: Order,
  ): Promise<void> {
    await this.orderRepository.update(order.id, {
      status: OrderStatus.CANCELED,
    });
    order.status = OrderStatus.CANCELED;
    await this.releaseReservedItems(
      order.items ?? [],
      order.reservationKey,
      true,
    );
  }

  /**
   * Credit an approved return's units back to available stock. Unlike
   * {@link releaseReservedItems} this works whatever state the reservation
   * reached, because the goods came back physically — a consumed reservation
   * (any order that got as far as COMPLETED) is exactly the case a release
   * cannot rewind. Non-fatal: a stock write must not sink the refund, but every
   * failure is logged so the shortfall is greppable in the service log.
   */
  private async restockReturnedItems(
    items: StockReservationItem[],
    reservationKey: string,
  ): Promise<void> {
    for (const item of items ?? []) {
      try {
        const restocked = await firstValueFrom(
          this.inventoryClient
            .send<boolean>(
              INVENTORY_MESSAGE_PATTERNS.INVENTORY_RESTOCK_RETURNED,
              {
                productId: item.productId,
                quantity: item.quantity,
                skuId: item.skuId ?? undefined,
                reservationKey,
              },
            )
            .pipe(timeout(5000)),
        );
        if (!restocked) {
          this.logger.error(
            `[ORDERS] Return restock rejected for product ${item.productId} (qty ${item.quantity}, reservation ${reservationKey})`,
          );
        }
      } catch (error) {
        this.logger.error(
          `[ORDERS] Return restock failed for product ${item.productId}: ${String(error)}`,
        );
      }
    }
  }

  private async releaseReservedItems(
    items: StockReservationItem[],
    reservationKey: string,
    throwOnFailure = false,
  ): Promise<void> {
    const failedProductIds: number[] = [];
    for (const item of [...items].reverse()) {
      try {
        const released = await firstValueFrom(
          this.inventoryClient
            .send<boolean>(INVENTORY_MESSAGE_PATTERNS.INVENTORY_RELEASE_STOCK, {
              productId: item.productId,
              quantity: item.quantity,
              skuId: item.skuId ?? undefined,
              reservationKey,
            })
            .pipe(timeout(5000)),
        );
        if (!released) {
          failedProductIds.push(item.productId);
          this.logger.error(
            `[ORDERS] Failed to compensate reservation for product ${item.productId}`,
          );
        }
      } catch (error) {
        failedProductIds.push(item.productId);
        this.logger.error(
          `[ORDERS] Reservation compensation failed for product ${item.productId}: ${String(error)}`,
        );
      }
    }
    if (throwOnFailure && failedProductIds.length > 0) {
      throw new ServiceUnavailableException(
        ORDER_MESSAGE.RESERVATION_COMPENSATION_FAILED(
          failedProductIds.join(", "),
        ),
      );
    }
  }

  /**
   * Price the shipping leg for a checkout that has not been committed yet.
   *
   * Two failure classes, deliberately handled differently (PRODTEST-0806 #2):
   *
   * - **GHN refuses the address** (unknown district, ward from another district,
   *   free-text that resolves to nothing → `BadRequestException`). The refusal
   *   is deterministic: `buildShippingOrderBody` is shared with
   *   `createShippingOrder`, so a waybill for this address can NEVER be cut.
   *   Swallowing it booked an order at fee 0 that ready-to-ship could only
   *   reject forever, leaving cancel as the buyer's single option. Propagate it
   *   instead — nothing is reserved or committed at this point, so the buyer
   *   gets the same actionable 400 that `POST /api/order/shipping-fee` already
   *   returns and can fix the address before an order exists.
   * - **GHN is unreachable** (outage, timeout, circuit open → 503/500). Nothing
   *   is wrong with the order, so stay fail-open: place it at fee 0 and let
   *   ready-to-ship cut the waybill on retry.
   */
  private async getShippingFeeOrZero(
    shippingAddress: string,
    codAmount: number,
    items: Array<{
      productName: string;
      quantity: number;
      price: number;
      weight?: number;
    }>,
    resolvedIds?: GhnResolvedAddress,
  ): Promise<number> {
    try {
      const preview = await this.ghnService.previewShippingFee(
        shippingAddress,
        codAmount,
        items.map(
          (i): GhnShippingItem => ({
            productName: i.productName,
            quantity: i.quantity,
            price: i.price,
            weight: i.weight,
          }),
        ),
        resolvedIds,
      );
      return preview.shippingFee;
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      this.logger.warn(
        `[ORDERS] GHN fee preview failed — shipping fee defaulted to 0: ${String(err)}`,
      );
      return 0;
    }
  }

  async calculateShippingFee(
    shippingAddress: string,
    items: Array<{
      productName?: string;
      quantity: number;
      price?: number;
      weight?: number;
    }>,
    resolvedIds?: GhnResolvedAddress,
  ): Promise<ShippingFeePreview> {
    return this.ghnService.previewShippingFee(
      shippingAddress,
      0,
      items.map(
        (i): GhnShippingItem => ({
          productName: i.productName ?? "item",
          quantity: i.quantity,
          price: Math.round(Number(i.price ?? 0)),
          weight: i.weight,
        }),
      ),
      resolvedIds,
    );
  }

  // GHN master-data proxies for the storefront address dropdowns — delegate to
  // the cached GHN reads so the FE can build cascading province/district/ward
  // selectors that yield GHN codes (the fee preview / waybill later consume).
  async listShippingProvinces(): Promise<{ id: number; name: string }[]> {
    return this.ghnService.listProvinces();
  }

  async listShippingDistricts(
    provinceId: number,
  ): Promise<{ id: number; name: string }[]> {
    return this.ghnService.listDistricts(provinceId);
  }

  async listShippingWards(
    districtId: number,
  ): Promise<{ id: string; name: string }[]> {
    return this.ghnService.listWards(districtId);
  }

  /**
   * Buyer order history. `q` is an order-code search: a case-insensitive
   * substring match on the order public id, ANDed with `status` so the returned
   * `total` describes the searched set (the FE search box paginates on it).
   * The `ord_` prefix is optional in the input because buyers paste fragments.
   */
  async getOrdersByUser(
    userId: number,
    page: number = 1,
    limit: number = 10,
    status?: OrderStatus[],
    q?: string,
  ): Promise<PaginatedResponse<Order>> {
    const term = q?.trim();
    const [data, total] = await this.orderRepository.findAndCount({
      where: {
        userId,
        ...(status?.length ? { status: In(status) } : {}),
        ...(term ? { publicId: Like(`%${escapeLikeTerm(term)}%`) } : {}),
      },
      relations: ["items"],
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return PaginatedResponse.of(data, total, page, limit);
  }

  /**
   * Server-side order counts grouped by status for a single buyer. The FE tab
   * badges need totals across the whole order history, not just the loaded page,
   * so this aggregates with a single GROUP BY query (P1-02). Returns every
   * `OrderStatus` key (zero-filled) plus an `all` total.
   */
  async getStatusCountsByUser(userId: number): Promise<Record<string, number>> {
    const rows = await this.orderRepository
      .createQueryBuilder("order")
      .select("order.status", "status")
      .addSelect("COUNT(*)", "count")
      .where("order.userId = :userId", { userId })
      .groupBy("order.status")
      .getRawMany<{ status: string; count: string }>();

    const counts: Record<string, number> = { all: 0 };
    for (const status of Object.values(OrderStatus)) {
      counts[status] = 0;
    }
    for (const row of rows) {
      const count = Number(row.count);
      counts[row.status] = count;
      counts.all += count;
    }
    return counts;
  }

  /**
   * F4 — dashboard analytics. When `sellerId` is a number the aggregates are
   * scoped to that seller's orders/items; when it is null they are global
   * (admin / shipping console). Revenue is goods revenue — SUM(price *
   * quantity) over `order_items` in COMPLETED orders — so it is consistent with
   * `topProducts` revenue and excludes shipping fees (paid to GHN) and voucher
   * discounts. `statusDistribution` counts every order created in the window
   * regardless of status so pending/canceled/refunded stay visible.
   */
  async getAnalytics(query: AnalyticsQuery): Promise<OrderAnalytics> {
    const interval: "day" | "month" =
      query.interval === "month" ? "month" : "day";
    const topN = Math.min(Math.max(query.topN ?? 5, 1), 50);
    const { fromDate, toDate } = this.resolveAnalyticsRange(
      query.from,
      query.to,
    );
    const sellerId = query.sellerId;
    const dateFormat = interval === "month" ? "%Y-%m" : "%Y-%m-%d";

    // 1. Status distribution — every order created in the window.
    const statusQb = this.orderRepository
      .createQueryBuilder("order")
      .select("order.status", "status")
      .addSelect("COUNT(*)", "count")
      .where("order.createdAt BETWEEN :fromDate AND :toDate", {
        fromDate,
        toDate,
      })
      .groupBy("order.status");
    if (sellerId != null) {
      statusQb.andWhere("order.sellerId = :sellerId", { sellerId });
    }
    const statusRows = await statusQb.getRawMany<{
      status: string;
      count: string;
    }>();

    const statusDistribution: Record<string, number> = {};
    for (const status of Object.values(OrderStatus)) {
      statusDistribution[status] = 0;
    }
    let totalOrders = 0;
    for (const row of statusRows) {
      const count = Number(row.count);
      statusDistribution[row.status] = count;
      totalOrders += count;
    }
    const completedOrders = statusDistribution[OrderStatus.COMPLETED] ?? 0;

    // 2. Revenue over time — goods revenue from COMPLETED orders per period.
    const revenueQb = this.orderItemRepository
      .createQueryBuilder("oi")
      .innerJoin("oi.order", "o")
      .select(`DATE_FORMAT(o.createdAt, '${dateFormat}')`, "period")
      .addSelect("SUM(oi.price * oi.quantity)", "revenue")
      .addSelect("COUNT(DISTINCT o.id)", "orderCount")
      .where("o.status = :status", { status: OrderStatus.COMPLETED })
      .andWhere("o.createdAt BETWEEN :fromDate AND :toDate", {
        fromDate,
        toDate,
      })
      .groupBy("period")
      .orderBy("period", "ASC");
    if (sellerId != null) {
      revenueQb.andWhere("oi.sellerId = :sellerId", { sellerId });
    }
    const revenueRows = await revenueQb.getRawMany<{
      period: string;
      revenue: string | null;
      orderCount: string;
    }>();

    const revenueOverTime: RevenuePoint[] = revenueRows.map((row) => ({
      period: row.period,
      revenue: Math.round(Number(row.revenue ?? 0)),
      orderCount: Number(row.orderCount),
    }));
    const totalRevenue = revenueOverTime.reduce(
      (sum, point) => sum + point.revenue,
      0,
    );

    // 3. Top products by quantity sold (COMPLETED orders only).
    const topQb = this.orderItemRepository
      .createQueryBuilder("oi")
      .innerJoin("oi.order", "o")
      .select("oi.productId", "productId")
      .addSelect("MAX(oi.productName)", "productName")
      .addSelect("SUM(oi.quantity)", "quantitySold")
      .addSelect("SUM(oi.price * oi.quantity)", "revenue")
      .where("o.status = :status", { status: OrderStatus.COMPLETED })
      .andWhere("o.createdAt BETWEEN :fromDate AND :toDate", {
        fromDate,
        toDate,
      })
      .groupBy("oi.productId")
      .orderBy("quantitySold", "DESC")
      .limit(topN);
    if (sellerId != null) {
      topQb.andWhere("oi.sellerId = :sellerId", { sellerId });
    }
    const topRows = await topQb.getRawMany<{
      productId: string;
      productName: string;
      quantitySold: string;
      revenue: string | null;
    }>();

    const topProducts: TopProduct[] = topRows.map((row) => ({
      productId: Number(row.productId),
      productName: row.productName,
      quantitySold: Number(row.quantitySold),
      revenue: Math.round(Number(row.revenue ?? 0)),
    }));

    return {
      scope: sellerId != null ? "seller" : "global",
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      interval,
      summary: {
        totalRevenue,
        completedOrders,
        totalOrders,
        averageOrderValue:
          completedOrders > 0 ? Math.round(totalRevenue / completedOrders) : 0,
      },
      revenueOverTime,
      statusDistribution,
      topProducts,
    };
  }

  /**
   * Resolve the analytics window. Both bounds are optional; defaults to the
   * last 30 days. Dates are treated as calendar-day granular — `from` snaps to
   * start-of-day and `to` to end-of-day (inclusive).
   */
  private resolveAnalyticsRange(
    from?: string,
    to?: string,
  ): { fromDate: Date; toDate: Date } {
    let toDate: Date;
    if (to) {
      toDate = new Date(to);
      if (Number.isNaN(toDate.getTime())) {
        throw new BadRequestException(ORDER_MESSAGE.INVALID_TO_DATE(to));
      }
      toDate.setHours(23, 59, 59, 999);
    } else {
      toDate = new Date();
    }

    let fromDate: Date;
    if (from) {
      fromDate = new Date(from);
      if (Number.isNaN(fromDate.getTime())) {
        throw new BadRequestException(ORDER_MESSAGE.INVALID_FROM_DATE(from));
      }
      fromDate.setHours(0, 0, 0, 0);
    } else {
      fromDate = new Date(toDate);
      fromDate.setDate(fromDate.getDate() - 30);
      fromDate.setHours(0, 0, 0, 0);
    }

    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException(ORDER_MESSAGE.FROM_AFTER_TO);
    }
    return { fromDate, toDate };
  }

  /**
   * Admin list. Shares the `q` order-code search with `getOrdersByUser` because
   * both are driven by the same gateway query DTO — leaving it unwired here
   * would advertise a `?q=` in Swagger that silently returns unfiltered rows.
   */
  async getAllOrders(
    page: number = 1,
    limit: number = 10,
    status?: OrderStatus[],
    q?: string,
  ): Promise<PaginatedResponse<Order>> {
    const term = q?.trim();
    const where = {
      ...(status?.length ? { status: In(status) } : {}),
      ...(term ? { publicId: Like(`%${escapeLikeTerm(term)}%`) } : {}),
    };
    const [data, total] = await this.orderRepository.findAndCount({
      ...(Object.keys(where).length ? { where } : {}),
      relations: ["items"],
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return PaginatedResponse.of(data, total, page, limit);
  }

  async getAdminGhnOrders(
    query: AdminGhnOrderListQuery,
  ): Promise<PaginatedResponse<AdminGhnOrderListItem>> {
    const page = query.page;
    const limit = query.limit;
    const qb = this.orderRepository
      .createQueryBuilder("order")
      .orderBy("order.updatedAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit);

    if (query.status) {
      qb.andWhere("order.status = :status", { status: query.status });
    }
    if (query.hasGhnCode === true) {
      qb.andWhere("order.ghnOrderCode IS NOT NULL");
    } else if (query.hasGhnCode === false) {
      qb.andWhere("order.ghnOrderCode IS NULL");
    }
    if (query.ghnStatus) {
      qb.andWhere(
        `order.id IN (
          SELECT DISTINCT shipping_history.order_id
          FROM shipping_history
          WHERE shipping_history.ghn_status = :ghnStatus
        )`,
        { ghnStatus: query.ghnStatus },
      );
    }
    if (query.search) {
      const search = query.search.trim();
      const searchId = Number(search);
      qb.andWhere(
        new Brackets((where) => {
          where.where("order.ghnOrderCode LIKE :search", {
            search: `%${search}%`,
          });
          where.orWhere("order.shippingAddress LIKE :search", {
            search: `%${search}%`,
          });
          if (Number.isInteger(searchId)) {
            where.orWhere("order.id = :searchId", { searchId });
          }
          if (isPublicId(PUBLIC_ID_PREFIXES.ORDER, search)) {
            where.orWhere("order.publicId = :searchPublicId", {
              searchPublicId: search,
            });
          }
        }),
      );
    }
    if (query.dateFrom) {
      qb.andWhere("order.createdAt >= :dateFrom", {
        dateFrom: new Date(query.dateFrom),
      });
    }
    if (query.dateTo) {
      qb.andWhere("order.createdAt <= :dateTo", {
        dateTo: new Date(query.dateTo),
      });
    }

    const [orders, total] = await qb.getManyAndCount();
    const latestHistory = await this.findLatestShippingHistory(
      orders.map((order) => order.id),
    );
    const data = orders.map((order) =>
      this.toAdminGhnOrderListItem(order, latestHistory.get(order.id)),
    );
    return PaginatedResponse.of(data, total, page, limit);
  }

  async getAdminGhnOrderDetail(orderId: number): Promise<AdminGhnOrderDetail> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }

    const latestHistory = await this.findLatestShippingHistory([order.id]);
    const latest = latestHistory.get(order.id);

    let ghnDetail: GhnOrderDetail | null = null;
    let ghnDetailError: string | null = null;
    if (order.ghnOrderCode) {
      try {
        ghnDetail = await this.ghnService.getOrderDetail(order.ghnOrderCode);
      } catch (error) {
        ghnDetailError = this.toErrorMessage(error);
      }
    }

    // Demo mode: the operator drives the GHN lifecycle through `demo-status`
    // instead of real GHN webhooks, but the GHN sandbox never advances a
    // waybill — so live `getOrderDetail` stays stuck (e.g. ready_to_pick) and
    // contradicts the demo-driven local status/history. When demo mode is on
    // and the latest history row is a demo-driven status, make it authoritative
    // for the GHN-side field, mirroring how a real webhook would have mutated
    // GHN's own system. Outside demo mode, live GHN wins unchanged.
    if (
      process.env.GHN_DEMO_ENDPOINTS_ENABLED === "true" &&
      latest?.action === "demo_status" &&
      latest.ghnStatus
    ) {
      ghnDetail = this.buildDemoGhnDetail(
        ghnDetail,
        order.ghnOrderCode,
        latest.ghnStatus,
      );
      ghnDetailError = null;
    }

    return {
      localOrder: this.toAdminGhnLocalOrder(order),
      ghnDetail,
      ghnDetailError,
      lastGhnStatus: latest?.ghnStatus ?? null,
      lastSyncedAt: latest?.createdAt ?? null,
      availableActions: this.getAvailableShippingActions(order),
    };
  }

  /**
   * Overlay a demo-driven GHN status onto the detail surfaced to the console.
   * When live GHN detail was fetched, only its `status` is overridden so the
   * real receiver/COD fields are preserved; when it was null (no waybill yet,
   * or the live fetch failed) a minimal detail is synthesized so the GHN status
   * badge still reflects the demo state. DEMO ONLY — only reached when
   * `GHN_DEMO_ENDPOINTS_ENABLED === "true"`.
   */
  private buildDemoGhnDetail(
    liveDetail: GhnOrderDetail | null,
    orderCode: string | null,
    demoStatus: string,
  ): GhnOrderDetail {
    if (liveDetail) {
      return { ...liveDetail, status: demoStatus };
    }
    return {
      orderCode: orderCode ?? "",
      status: demoStatus,
      codAmount: null,
      totalFee: null,
      expectedDeliveryTime: null,
      leadtime: null,
      toName: null,
      toPhone: null,
      toAddress: null,
      fromName: null,
      fromPhone: null,
      raw: {},
    };
  }

  async syncAdminGhnOrder(
    orderId: number,
    actorId: number | null,
  ): Promise<AdminGhnSyncResult> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    if (!order.ghnOrderCode) {
      throw new BadRequestException(
        ORDER_MESSAGE.NO_GHN_ORDER_CODE(order.publicId ?? String(order.id)),
      );
    }

    const previousStatus = order.status ?? OrderStatus.PENDING;
    let detail: GhnOrderDetail;
    try {
      detail = await this.ghnService.getOrderDetail(order.ghnOrderCode);
    } catch (error) {
      await this.recordShippingHistory({
        orderId: order.id,
        type: ShippingHistoryType.MANUAL_SYNC,
        actorId,
        action: "sync_detail",
        previousStatus,
        newStatus: previousStatus,
        ghnStatus: null,
        success: false,
        message: this.toErrorMessage(error),
        payloadSummary: { orderCode: order.ghnOrderCode },
      });
      throw error;
    }

    if (!detail.status) {
      const message = ORDER_MESSAGE.GHN_DETAIL_STATUS_MISSING;
      const history = await this.recordShippingHistory({
        orderId: order.id,
        type: ShippingHistoryType.MANUAL_SYNC,
        actorId,
        action: "sync_detail",
        previousStatus,
        newStatus: previousStatus,
        ghnStatus: null,
        success: false,
        message,
        payloadSummary: { orderCode: order.ghnOrderCode },
      });
      throw new BadRequestException(
        ORDER_MESSAGE.GHN_DETAIL_STATUS_MISSING_WITH_HISTORY(
          message,
          history.id,
        ),
      );
    }

    const result = await this.applyGhnStatus(order, detail.status);
    const history = await this.recordShippingHistory({
      orderId: order.id,
      type: ShippingHistoryType.MANUAL_SYNC,
      actorId,
      action: "sync_detail",
      previousStatus: result.previousStatus ?? null,
      newStatus: result.newStatus ?? null,
      ghnStatus: detail.status,
      success: true,
      message: result.message,
      payloadSummary: {
        orderCode: detail.orderCode,
        changed: result.changed,
      },
    });

    return {
      orderId: order.publicId ?? String(order.id),
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
      ghnStatus: detail.status,
      syncedAt: history.createdAt,
    };
  }

  /**
   * DEMO-ONLY: simulate a GHN status change without calling the real GHN API,
   * so a demo can drive the full lifecycle (picking → delivering → delivered)
   * that the GHN sandbox never advances on its own. Behaves exactly like an
   * inbound webhook/sync — it runs the supplied status through the same
   * `applyGhnStatus` mapping (forward-only, terminal-safe), records a
   * `shipping_history` row and updates the order — but the GHN-side status is
   * provided by the caller instead of fetched. Gated behind
   * `GHN_DEMO_ENDPOINTS_ENABLED` so it can never be reached in production.
   */
  async setDemoGhnStatus(
    orderId: number,
    actorId: number | null,
    ghnStatus: string,
  ): Promise<AdminGhnSyncResult> {
    if (process.env.GHN_DEMO_ENDPOINTS_ENABLED !== "true") {
      throw new ForbiddenException(ORDER_MESSAGE.GHN_DEMO_DISABLED);
    }

    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }

    const result = await this.applyGhnStatus(order, ghnStatus);
    const history = await this.recordShippingHistory({
      orderId: order.id,
      type: ShippingHistoryType.MANUAL_SYNC,
      actorId,
      action: "demo_status",
      previousStatus: result.previousStatus ?? null,
      newStatus: result.newStatus ?? null,
      ghnStatus,
      success: true,
      message: result.message,
      payloadSummary: {
        orderCode: order.ghnOrderCode,
        changed: result.changed,
        demo: true,
      },
    });

    return {
      orderId: order.publicId ?? String(order.id),
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
      ghnStatus,
      syncedAt: history.createdAt,
    };
  }

  async cancelAdminGhnOrder(
    orderId: number,
    actorId: number | null,
  ): Promise<AdminGhnActionResult> {
    return this.applyAdminGhnAction(orderId, actorId, "cancel");
  }

  async returnAdminGhnOrder(
    orderId: number,
    actorId: number | null,
  ): Promise<AdminGhnActionResult> {
    return this.applyAdminGhnAction(orderId, actorId, "return");
  }

  /**
   * Drives a GHN shop-callable switch-status action (cancel / return) for a
   * single waybill, then reconciles the local order. Both actions resolve the
   * order to CANCELED locally (GHN return = parcel sent back to the shop), so
   * the success path reuses `finalizeGhnCancellation` (release reserved stock +
   * publish ORDER_CANCELED_EVENT). If GHN rejects the action the local order is
   * left untouched, an ACTION history row is recorded with `success:false`, and
   * the error propagates so the gateway surfaces it as 4xx/5xx.
   */
  private async applyAdminGhnAction(
    orderId: number,
    actorId: number | null,
    action: AdminGhnActionType,
  ): Promise<AdminGhnActionResult> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    if (!order.ghnOrderCode) {
      throw new BadRequestException(
        ORDER_MESSAGE.NO_GHN_ORDER_CODE(order.publicId ?? String(order.id)),
      );
    }
    if (!this.getAvailableShippingActions(order).includes(action)) {
      throw new BadRequestException(
        ORDER_MESSAGE.GHN_ACTION_NOT_ALLOWED(
          action,
          order.publicId ?? String(order.id),
          order.status,
        ),
      );
    }

    const ghnOrderCode = order.ghnOrderCode;
    const previousStatus = order.status ?? OrderStatus.PENDING;

    try {
      if (action === "cancel") {
        await this.ghnService.cancelShippingOrder(ghnOrderCode);
      } else {
        await this.ghnService.returnShippingOrder(ghnOrderCode);
      }
    } catch (error) {
      await this.tryRecordShippingHistory({
        orderId: order.id,
        type: ShippingHistoryType.ACTION,
        actorId,
        action,
        previousStatus,
        newStatus: previousStatus,
        ghnStatus: null,
        success: false,
        message: this.toErrorMessage(error),
        payloadSummary: { orderCode: ghnOrderCode },
      });
      throw error;
    }

    // GHN accepted the action — flip the local order to CANCELED exactly once.
    const updateResult = await this.orderRepository.update(
      { id: order.id, status: previousStatus },
      { status: OrderStatus.CANCELED },
    );
    const changed = updateResult.affected === 1;
    if (changed) {
      order.status = OrderStatus.CANCELED;
      await this.finalizeGhnCancellation(order);
    } else {
      this.logger.warn(
        `[GHN] Order ${order.id} changed concurrently; GHN ${action} accepted but local status not flipped`,
      );
    }

    const message = changed
      ? ORDER_MESSAGE.GHN_ACTION_ACCEPTED_CANCELED(action)
      : ORDER_MESSAGE.GHN_ACTION_ACCEPTED_CONCURRENT(action);
    const history = await this.recordShippingHistory({
      orderId: order.id,
      type: ShippingHistoryType.ACTION,
      actorId,
      action,
      previousStatus,
      newStatus: changed ? OrderStatus.CANCELED : previousStatus,
      ghnStatus: null,
      success: true,
      message,
      payloadSummary: { orderCode: ghnOrderCode, changed },
    });

    return {
      orderId: order.publicId ?? String(order.id),
      action,
      ghnOrderCode,
      previousStatus,
      newStatus: changed ? OrderStatus.CANCELED : previousStatus,
      success: true,
      message,
      actionedAt: history.createdAt,
    };
  }

  /**
   * Update the COD amount on a GHN waybill and mirror it to the local order.
   * Only valid while the parcel is still editable (CONFIRMED / PROCESSING, with
   * a GHN code). GHN is the final arbiter: if it rejects the edit the local
   * order is left untouched, a `success:false` ACTION row is recorded, and the
   * error propagates so the gateway surfaces it as 4xx/5xx.
   */
  async updateAdminGhnCod(
    orderId: number,
    actorId: number | null,
    codAmount: number,
  ): Promise<AdminGhnUpdateCodResult> {
    if (!Number.isFinite(codAmount) || codAmount < 0) {
      throw new BadRequestException(ORDER_MESSAGE.COD_AMOUNT_INVALID);
    }
    const order = await this.loadEditableGhnOrder(orderId, "update_cod");
    const ghnOrderCode = order.ghnOrderCode as string;
    const previousCodAmount = Number(order.codAmount ?? 0);
    const newCodAmount = Math.round(codAmount);

    try {
      await this.ghnService.updateOrderCod(ghnOrderCode, newCodAmount);
    } catch (error) {
      await this.tryRecordShippingHistory({
        orderId: order.id,
        type: ShippingHistoryType.ACTION,
        actorId,
        action: "update_cod",
        previousStatus: order.status ?? null,
        newStatus: order.status ?? null,
        ghnStatus: null,
        success: false,
        message: this.toErrorMessage(error),
        payloadSummary: { orderCode: ghnOrderCode, newCodAmount },
      });
      throw error;
    }

    order.codAmount = newCodAmount;
    await this.orderRepository.update(
      { id: order.id },
      { codAmount: newCodAmount },
    );

    const message = ORDER_MESSAGE.GHN_COD_UPDATED(
      previousCodAmount,
      newCodAmount,
    );
    const history = await this.recordShippingHistory({
      orderId: order.id,
      type: ShippingHistoryType.ACTION,
      actorId,
      action: "update_cod",
      previousStatus: order.status ?? null,
      newStatus: order.status ?? null,
      ghnStatus: null,
      success: true,
      message,
      payloadSummary: {
        orderCode: ghnOrderCode,
        previousCodAmount,
        newCodAmount,
      },
    });

    return {
      orderId: order.publicId ?? String(order.id),
      action: "update_cod",
      ghnOrderCode,
      previousCodAmount,
      newCodAmount,
      success: true,
      message,
      actionedAt: history.createdAt,
    };
  }

  /**
   * Update the receiver name/phone/address on a GHN waybill and mirror the
   * changed parts back onto the local pipe-delimited `shippingAddress`. Same
   * editable-window + GHN-arbiter + history semantics as `updateAdminGhnCod`.
   */
  async updateAdminGhnReceiver(
    orderId: number,
    actorId: number | null,
    receiver: AdminGhnReceiverUpdateInput,
  ): Promise<AdminGhnUpdateReceiverResult> {
    const update: GhnReceiverUpdate = {};
    const updatedFields: string[] = [];
    if (this.hasText(receiver.toName)) {
      update.toName = receiver.toName.trim();
      updatedFields.push("toName");
    }
    if (this.hasText(receiver.toPhone)) {
      update.toPhone = receiver.toPhone.trim();
      updatedFields.push("toPhone");
    }
    if (this.hasText(receiver.toAddress)) {
      update.toAddress = receiver.toAddress.trim();
      updatedFields.push("toAddress");
    }
    if (updatedFields.length === 0) {
      throw new BadRequestException(ORDER_MESSAGE.RECEIVER_FIELDS_REQUIRED);
    }

    const order = await this.loadEditableGhnOrder(orderId, "update_receiver");
    const ghnOrderCode = order.ghnOrderCode as string;

    try {
      await this.ghnService.updateOrderReceiver(ghnOrderCode, update);
    } catch (error) {
      await this.tryRecordShippingHistory({
        orderId: order.id,
        type: ShippingHistoryType.ACTION,
        actorId,
        action: "update_receiver",
        previousStatus: order.status ?? null,
        newStatus: order.status ?? null,
        ghnStatus: null,
        success: false,
        message: this.toErrorMessage(error),
        payloadSummary: {
          orderCode: ghnOrderCode,
          fields: updatedFields.join(","),
        },
      });
      throw error;
    }

    const shippingAddress = this.applyReceiverToShippingAddress(
      order.shippingAddress,
      update,
    );
    order.shippingAddress = shippingAddress;
    await this.orderRepository.update({ id: order.id }, { shippingAddress });

    const message = ORDER_MESSAGE.GHN_RECEIVER_UPDATED(
      updatedFields.join(", "),
    );
    const history = await this.recordShippingHistory({
      orderId: order.id,
      type: ShippingHistoryType.ACTION,
      actorId,
      action: "update_receiver",
      previousStatus: order.status ?? null,
      newStatus: order.status ?? null,
      ghnStatus: null,
      success: true,
      message,
      payloadSummary: {
        orderCode: ghnOrderCode,
        fields: updatedFields.join(","),
      },
    });

    return {
      orderId: order.publicId ?? String(order.id),
      action: "update_receiver",
      ghnOrderCode,
      shippingAddress,
      updatedFields,
      success: true,
      message,
      actionedAt: history.createdAt,
    };
  }

  // Load an order that must have a GHN code and currently allow `action` per the
  // shipping-action matrix; otherwise 404 / 400 just like the cancel/return path.
  private async loadEditableGhnOrder(
    orderId: number,
    action: string,
  ): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    if (!order.ghnOrderCode) {
      throw new BadRequestException(
        ORDER_MESSAGE.NO_GHN_ORDER_CODE(order.publicId ?? String(order.id)),
      );
    }
    if (!this.getAvailableShippingActions(order).includes(action)) {
      throw new BadRequestException(
        ORDER_MESSAGE.GHN_ACTION_NOT_ALLOWED(
          action,
          order.publicId ?? String(order.id),
          order.status,
        ),
      );
    }
    return order;
  }

  private hasText(value: string | undefined): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }

  // Replace the name/phone/address parts of the pipe-delimited shippingAddress
  // (name|phone|addr|ward|district|province) while preserving the resolved
  // ward/district/province so future GHN resolution stays intact.
  private applyReceiverToShippingAddress(
    shippingAddress: string,
    update: GhnReceiverUpdate,
  ): string {
    const parts = shippingAddress.split("|");
    while (parts.length < 6) {
      parts.push("");
    }
    if (update.toName !== undefined) parts[0] = update.toName;
    if (update.toPhone !== undefined) parts[1] = update.toPhone;
    if (update.toAddress !== undefined) parts[2] = update.toAddress;
    return parts.join("|");
  }

  async getAdminGhnHistory(orderId: number): Promise<ShippingHistory[]> {
    const exists = await this.orderRepository.exist({ where: { id: orderId } });
    if (!exists) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    return this.shippingHistoryRepository.find({
      where: { orderId },
      order: { createdAt: "DESC" },
    });
  }

  private async findLatestShippingHistory(
    orderIds: number[],
  ): Promise<Map<number, ShippingHistory>> {
    if (orderIds.length === 0) {
      return new Map();
    }
    const histories = await this.shippingHistoryRepository.find({
      where: { orderId: In(orderIds) },
      order: { createdAt: "DESC", id: "DESC" },
    });
    const latest = new Map<number, ShippingHistory>();
    for (const history of histories) {
      // `order_id` is a bigint column → mysql2 returns it as a string at
      // runtime, so coerce to number to match the `order.id` (int) lookup key.
      // Without this the map is keyed by "108" but read with 108 → always miss,
      // leaving lastGhnStatus/lastSyncedAt null on every list/detail row.
      const orderId = Number(history.orderId);
      if (!latest.has(orderId)) {
        latest.set(orderId, history);
      }
    }
    return latest;
  }

  private toAdminGhnOrderListItem(
    order: Order,
    latestHistory?: ShippingHistory,
  ): AdminGhnOrderListItem {
    return {
      orderId: order.publicId ?? String(order.id),
      userId: Number(order.userId),
      sellerId: Number(order.sellerId),
      orderStatus: order.status,
      ghnOrderCode: order.ghnOrderCode,
      shippingFee:
        order.shippingFee === null ? null : Number(order.shippingFee ?? 0),
      codAmount: order.codAmount === null ? null : Number(order.codAmount ?? 0),
      paymentMethod: order.paymentMethod,
      lastGhnStatus: latestHistory?.ghnStatus ?? null,
      lastSyncedAt: latestHistory?.createdAt ?? null,
      updatedAt: order.updatedAt,
      availableActions: this.getAvailableShippingActions(order),
    };
  }

  private toAdminGhnLocalOrder(
    order: Order,
  ): AdminGhnOrderDetail["localOrder"] {
    return {
      orderId: order.publicId ?? String(order.id),
      userId: Number(order.userId),
      sellerId: Number(order.sellerId),
      orderStatus: order.status,
      ghnOrderCode: order.ghnOrderCode,
      shippingAddress: order.shippingAddress,
      shippingFee:
        order.shippingFee === null ? null : Number(order.shippingFee ?? 0),
      codAmount: order.codAmount === null ? null : Number(order.codAmount ?? 0),
      paymentMethod: order.paymentMethod,
      total: Number(order.total),
      // PUBID-01: drop each item's numeric `orderId` FK before it leaves the
      // service — the parent's public id already identifies the order.
      items: (order.items ?? []).map((item) => {
        const exposed: Record<string, unknown> = { ...item };
        delete exposed.orderId;
        return exposed as unknown as Omit<OrderItem, "orderId">;
      }),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private getAvailableShippingActions(order: Order): string[] {
    const actions = ["read", "history"];
    if (!order.ghnOrderCode) {
      return actions;
    }
    actions.push("sync");

    const status = order.status;
    const isTerminal =
      status === OrderStatus.CANCELED || status === OrderStatus.COMPLETED;
    if (!isTerminal) {
      // PENDING counts everywhere CONFIRMED does: the waybill is created during
      // checkout, so a brand-new order sits at `pending` locally while GHN
      // already holds it at `ready_to_pick` — the widest editable window there
      // is. Omitting it here left every freshly placed order with no mutating
      // action at all, which is what made the console read-only in practice.
      // Cancel: valid while the parcel has not yet entered active delivery.
      if (
        status === OrderStatus.PENDING ||
        status === OrderStatus.CONFIRMED ||
        status === OrderStatus.PROCESSING ||
        status === OrderStatus.SHIPPED
      ) {
        actions.push("cancel");
      }
      // Return: valid once the parcel is in transit (send it back to the shop).
      if (status === OrderStatus.SHIPPED || status === OrderStatus.DELIVERING) {
        actions.push("return");
      }
      // Update COD / receiver: only while the waybill is still editable, i.e.
      // before the parcel is picked up. GHN rejects edits once in active
      // delivery; we surface that as an error rather than pre-blocking here.
      if (
        status === OrderStatus.PENDING ||
        status === OrderStatus.CONFIRMED ||
        status === OrderStatus.PROCESSING
      ) {
        actions.push("update_cod", "update_receiver");
      }
    }
    return actions;
  }

  private async recordShippingHistory(data: {
    orderId: number;
    type: ShippingHistoryType;
    actorId: number | null;
    action: string;
    previousStatus: string | null;
    newStatus: string | null;
    ghnStatus: string | null;
    success: boolean;
    message: string | null;
    payloadSummary: ShippingPayloadSummary | null;
  }): Promise<ShippingHistory> {
    return this.shippingHistoryRepository.save(
      this.shippingHistoryRepository.create(data),
    );
  }

  private async tryRecordShippingHistory(data: {
    orderId: number;
    type: ShippingHistoryType;
    actorId: number | null;
    action: string;
    previousStatus: string | null;
    newStatus: string | null;
    ghnStatus: string | null;
    success: boolean;
    message: string | null;
    payloadSummary: ShippingPayloadSummary | null;
  }): Promise<ShippingHistory | null> {
    try {
      return await this.recordShippingHistory(data);
    } catch (error) {
      this.logger.warn(
        `[GHN] Failed to record shipping history for order ${data.orderId}: ${this.toErrorMessage(error)}`,
      );
      return null;
    }
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message.slice(0, 500);
    }
    return String(error).slice(0, 500);
  }

  async getOrderById(orderId: number): Promise<Order | null> {
    return this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });
  }

  /**
   * PUBID-01 — resolve an order id received over TCP to the numeric PK.
   * The gateway forwards the opaque public id (`ord_...`); internal callers
   * (notification consumers, RMQ handlers) still send the numeric id. Unknown
   * public id → 404, same as a missing numeric order downstream.
   */
  async resolveOrderId(orderId: number | string): Promise<number> {
    if (typeof orderId === "number") {
      return orderId;
    }
    if (!isPublicId(PUBLIC_ID_PREFIXES.ORDER, orderId)) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    const order = await this.orderRepository.findOne({
      where: { publicId: orderId },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    return order.id;
  }

  async getOrderPublicIdsByIds(
    orderIds: number[],
  ): Promise<{ id: number; publicId: string | null }[]> {
    if (orderIds.length === 0) {
      return [];
    }
    return this.orderRepository.find({
      where: { id: In(orderIds) },
      select: { id: true, publicId: true },
    });
  }

  async updateOrderStatus(orderId: number, status: OrderStatus): Promise<void> {
    await this.orderRepository.update({ id: orderId }, { status });
    this.logger.log(`[ORDERS] Order ${orderId} status updated to ${status}`);
  }

  /**
   * Stamp the moment money was actually collected (ORD-GUARD-01). Conditional on
   * paid_at IS NULL so a replayed payment_completed — or the COD path stamping
   * locally and then hearing its own fanout event — never rewrites the original
   * timestamp. This column is what the seller transitions read; it is the only
   * payment fact orders owns, since payments lives on the other node.
   */
  private async markOrderPaid(orderId: number): Promise<Date | null> {
    const paidAt = new Date();
    const result = await this.orderRepository.update(
      { id: orderId, paidAt: IsNull() },
      { paidAt },
    );
    if (result.affected !== 1) {
      return null;
    }
    this.logger.log(`[ORDERS] Order ${orderId} marked paid`);
    return paidAt;
  }

  async handlePaymentCompleted(orderId: number): Promise<void> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });

    if (!order) {
      this.logger.warn(
        `[ORDERS] payment_completed: order ${orderId} not found`,
      );
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }

    // Before any early return: this event means the money is in, whatever the
    // method and whatever the order does next.
    await this.markOrderPaid(orderId);

    // COD orders: payment_completed is emitted by GHN webhook on delivery,
    // status is already COMPLETED at that point — nothing to do here
    if (order.paymentMethod === PaymentMethod.COD) {
      this.logger.log(
        `[ORDERS] payment_completed: COD order ${orderId} already processed by GHN webhook`,
      );
      return;
    }

    const currentStatus = order.status ?? OrderStatus.PENDING;
    if (
      currentStatus !== OrderStatus.PENDING &&
      currentStatus !== OrderStatus.CONFIRMED
    ) {
      this.logger.log(
        `[ORDERS] payment_completed: order ${orderId} is already ${currentStatus} — skipping GHN creation`,
      );
      return;
    }

    const claimResult = await this.orderRepository.update(
      { id: order.id, status: currentStatus, ghnOrderCode: IsNull() },
      { status: OrderStatus.PROCESSING },
    );
    if (claimResult.affected !== 1) {
      this.logger.log(
        `[ORDERS] payment_completed: order ${orderId} was already claimed — skipping GHN creation`,
      );
      return;
    }

    // ZaloPay/VNPay: create GHN shipping order (codAmount = null → 0 in GHN payload)
    try {
      const ghnCode = await this.ghnService.createShippingOrder(order);
      await this.orderRepository.update(order.id, { ghnOrderCode: ghnCode });
      order.ghnOrderCode = ghnCode;
      this.logger.log(`[ORDERS] GHN order created for ${orderId}: ${ghnCode}`);
    } catch (err) {
      this.logger.error(
        `[ORDERS] GHN createShippingOrder failed for order ${orderId}: ${err}`,
      );
    }
  }

  async cancelOrder(
    orderId: number,
    callerId: number,
    callerRole: string,
  ): Promise<Order> {
    const order = await this.getOrderById(orderId);
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }

    if (
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.CONFIRMED &&
      order.status !== OrderStatus.PROCESSING
    ) {
      throw new BadRequestException(ORDER_MESSAGE.CANNOT_CANCEL);
    }

    if (callerRole !== "admin" && Number(order.userId) !== callerId) {
      throw new ForbiddenException(ORDER_MESSAGE.CANCEL_FORBIDDEN);
    }

    await this.finalizeCancellation(order);

    this.logger.log(`[ORDERS] Order ${orderId} canceled by user ${callerId}`);
    return order;
  }

  /**
   * Cancellation side effects shared by the user-facing cancel endpoint and the
   * stale-reservation sweeper: flip the order to CANCELED, release reserved
   * stock (idempotent via reservationKey), cancel any GHN shipping order, and
   * publish the cancel event. Callers are responsible for status/permission
   * checks before invoking this.
   */
  private async finalizeCancellation(order: Order): Promise<void> {
    await this.updateOrderStatus(order.id, OrderStatus.CANCELED);
    order.status = OrderStatus.CANCELED;
    await this.releaseReservedItems(order.items, order.reservationKey, true);

    // Push the cancel to GHN so the shipping order stops too. Detached on
    // purpose: the local cancel is already committed at this point, so awaiting
    // a slow GHN call only risks blowing the caller's TCP budget and reporting a
    // failure for work that succeeded. Same best-effort shape as the waybill
    // create leg.
    if (order.ghnOrderCode) {
      void this.cancelShippingOrderBestEffort(order.id, order.ghnOrderCode);
    }

    this.publishOrderCanceledEvent(order);
  }

  /**
   * Fire-and-forget GHN cancel. Never rejects — a `void`-invoked promise that
   * rejects would surface as an unhandled rejection and kill the process.
   *
   * Retried once because nothing is waiting on it: the GHN client now times out
   * at 5s, so without a second attempt a slow-but-alive GHN would leave a live
   * waybill on a canceled order. Exhausting both attempts is logged and left to
   * the admin GHN cancel endpoint.
   */
  private async cancelShippingOrderBestEffort(
    orderId: number,
    ghnOrderCode: string,
  ): Promise<void> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await this.ghnService.cancelShippingOrder(ghnOrderCode);
        this.logger.log(
          `[ORDERS] GHN shipping order ${ghnOrderCode} canceled for order ${orderId}`,
        );
        return;
      } catch (err) {
        this.logger.error(
          `[ORDERS] GHN cancel attempt ${attempt}/2 failed for ${ghnOrderCode}: ${String(err)}`,
        );
      }
    }
  }

  /**
   * Cancellation triggered by GHN itself (a `cancel`/`return*` shipping status
   * pulled via webhook or manual sync). The order row is already flipped to
   * CANCELED by the conditional update in `applyGhnStatus`, so this only runs
   * the side effects: release the reserved stock (idempotent via
   * reservationKey) and announce the cancellation. Unlike `finalizeCancellation`
   * it must NOT push the cancel back to GHN — GHN is the originator here.
   */
  private async finalizeGhnCancellation(order: Order): Promise<void> {
    await this.releaseReservedItems(order.items, order.reservationKey, true);
    this.publishOrderCanceledEvent(order);
  }

  /**
   * Publishes ORDER_CANCELED_EVENT so downstream services (inventory, rewards)
   * can react. Shared by the user/sweeper cancel flow and the GHN-driven cancel.
   */
  private publishOrderCanceledEvent(order: Order): void {
    if (this.fanoutChannel && this.isFanoutChannelLive()) {
      this.fanoutChannel.publish(
        EXCHANGE.ORDERS_EXCHANGE,
        EVENT.ORDER_CANCELED_EVENT,
        Buffer.from(
          JSON.stringify({
            data: {
              orderId: order.id,
              reservationKey: order.reservationKey,
              items: order.items,
            },
            pattern: EVENT.ORDER_CANCELED_EVENT,
          }),
        ),
      );
    } else {
      this.logger.warn(
        `[ORDERS] RMQ channel unavailable — ${EVENT.ORDER_CANCELED_EVENT} event not published for order ${order.id}`,
      );
    }
  }

  /**
   * Default window (hours) after which an order still holding reserved stock
   * but with no GHN shipping code is considered abandoned/stuck and swept.
   */
  private readonly staleReservationTtlHours =
    Number(process.env.ORDER_STALE_RESERVATION_TTL_HOURS) || 24;

  private isSweepingStaleReservations = false;

  /**
   * Reclaims stock leaked by orders that can never reach GHN "delivered":
   * online-payment orders abandoned before payment, COD orders a seller never
   * confirmed, and orders whose GHN creation failed (ghn_order_code stays
   * null). Orders already handed to GHN (ghn_order_code set) are never swept —
   * their terminal state is driven by the delivery webhook. Reuses the
   * idempotent cancel flow so a swept order releases its reservation exactly
   * once.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepStaleReservations(): Promise<void> {
    if (this.isSweepingStaleReservations) {
      this.logger.warn(
        "[ORDERS] Stale-reservation sweep already running — skipping this tick",
      );
      return;
    }
    this.isSweepingStaleReservations = true;
    try {
      const cutoff = new Date(
        Date.now() - this.staleReservationTtlHours * 60 * 60 * 1000,
      );
      const staleOrders = await this.orderRepository.find({
        where: {
          status: In([
            OrderStatus.PENDING,
            OrderStatus.CONFIRMED,
            OrderStatus.PROCESSING,
          ]),
          ghnOrderCode: IsNull(),
          createdAt: LessThan(cutoff),
        },
        relations: ["items"],
        order: { id: "ASC" },
        // Bounded per tick: each sweep costs an inventory release (TCP) plus a
        // cancel event (RMQ) per order, so an accumulated backlog must drain
        // over several hours instead of firing as one burst against the
        // connection-capped databases. Runs hourly, so the backlog still
        // clears quickly.
        take: ORDER_STALE_SWEEP_BATCH_SIZE,
      });

      if (staleOrders.length === 0) return;

      this.logger.log(
        `[ORDERS] Sweeping ${staleOrders.length} stale order(s) older than ${this.staleReservationTtlHours}h`,
      );

      let swept = 0;
      for (const order of staleOrders) {
        try {
          await this.finalizeCancellation(order);
          swept += 1;
          this.logger.log(
            `[ORDERS] Stale order ${order.id} canceled and stock released`,
          );
        } catch (err) {
          this.logger.error(
            `[ORDERS] Failed to sweep stale order ${order.id}: ${String(err)}`,
          );
        }
      }
      this.logger.log(
        `[ORDERS] Stale-reservation sweep released ${swept}/${staleOrders.length} order(s)`,
      );
    } catch (err) {
      this.logger.error(
        `[ORDERS] Stale-reservation sweep failed: ${String(err)}`,
      );
    } finally {
      this.isSweepingStaleReservations = false;
    }
  }

  async handleGhnWebhook(
    ghnOrderCode: string,
    ghnStatus: string,
  ): Promise<void> {
    const order = await this.orderRepository.findOne({
      where: { ghnOrderCode },
      relations: ["items"],
    });

    if (!order) {
      this.logger.warn(
        `[GHN] Order not found for ghn_order_code: ${ghnOrderCode}`,
      );
      return;
    }

    const result = await this.applyGhnStatus(order, ghnStatus);
    await this.tryRecordShippingHistory({
      orderId: order.id,
      type: ShippingHistoryType.WEBHOOK,
      actorId: null,
      action: "ghn_webhook",
      previousStatus: result.previousStatus ?? null,
      newStatus: result.newStatus ?? null,
      ghnStatus,
      success: true,
      message: result.message,
      payloadSummary: {
        orderCode: ghnOrderCode,
        changed: result.changed,
      },
    });
  }

  private async applyGhnStatus(
    order: Order,
    ghnStatus: string,
  ): Promise<GhnStatusApplyResult> {
    const mappedStatus = this.mapGhnStatus(ghnStatus);
    const currentStatus = order.status ?? OrderStatus.PENDING;
    if (!mappedStatus) {
      // Two very different things end up here. A status we know has no local
      // equivalent (`delivery_fail`, the in-transit legs, `lost`, ...) is an
      // answered question — say so, because this message is persisted to
      // shipping_history and read in the console timeline, where "Unhandled"
      // looked like a bug. A string we have never seen is a real gap in the
      // mapping and stays loud at warn level.
      const isKnown = isGhnStatusWithoutLocalStatus(ghnStatus);
      const message = isKnown
        ? ORDER_MESSAGE.GHN_STATUS_NO_LOCAL_STATUS(ghnStatus, currentStatus)
        : ORDER_MESSAGE.GHN_STATUS_UNHANDLED(ghnStatus);
      const logLine = `[GHN] ${message} for order ${order.publicId ?? order.id}`;
      if (isKnown) {
        this.logger.log(logLine);
      } else {
        this.logger.warn(logLine);
      }
      return {
        previousStatus: currentStatus,
        newStatus: currentStatus,
        changed: false,
        message,
      };
    }

    if (
      currentStatus === OrderStatus.CANCELED ||
      currentStatus === OrderStatus.COMPLETED
    ) {
      // PUBID: this message is persisted to shipping_history and rendered in
      // the console timeline, so it must name the order the way HTTP does.
      const message = ORDER_MESSAGE.GHN_STATUS_TERMINAL_IGNORED(
        ghnStatus,
        order.publicId ?? String(order.id),
        currentStatus,
      );
      this.logger.warn(`[GHN] ${message}`);
      return {
        previousStatus: currentStatus,
        newStatus: currentStatus,
        changed: false,
        message,
      };
    }

    const statusRank: Record<OrderStatus, number> = {
      [OrderStatus.PENDING]: 0,
      [OrderStatus.CONFIRMED]: 1,
      [OrderStatus.PROCESSING]: 2,
      [OrderStatus.SHIPPED]: 3,
      [OrderStatus.DELIVERING]: 4,
      [OrderStatus.COMPLETED]: 5,
      [OrderStatus.CANCELED]: 6,
      [OrderStatus.RETURN_REQUESTED]: 7,
      [OrderStatus.REFUNDED]: 8,
    };
    if (statusRank[mappedStatus] <= statusRank[currentStatus]) {
      const message = ORDER_MESSAGE.GHN_STATUS_STALE_IGNORED(
        ghnStatus,
        order.publicId ?? String(order.id),
        currentStatus,
      );
      this.logger.log(`[GHN] ${message}`);
      return {
        previousStatus: currentStatus,
        newStatus: currentStatus,
        changed: false,
        message,
      };
    }

    const updateResult = await this.orderRepository.update(
      { id: order.id, status: currentStatus },
      { status: mappedStatus },
    );
    if (updateResult.affected !== 1) {
      const message = ORDER_MESSAGE.GHN_STATUS_CONCURRENT_SKIPPED(
        order.publicId ?? String(order.id),
        ghnStatus,
      );
      this.logger.log(`[GHN] ${message}`);
      return {
        previousStatus: currentStatus,
        newStatus: currentStatus,
        changed: false,
        message,
      };
    }

    order.status = mappedStatus;
    this.logger.log(
      `[GHN] Order ${order.id} status updated to ${mappedStatus}`,
    );
    if (mappedStatus === OrderStatus.COMPLETED) {
      await this.finalizeOrderCompletion(order);
    } else if (mappedStatus === OrderStatus.CANCELED) {
      await this.finalizeGhnCancellation(order);
    }
    if (mappedStatus !== OrderStatus.CANCELED) {
      // finalizeGhnCancellation publishes order_canceled itself — publishing
      // here too would notify the buyer twice for the same move.
      this.publishOrderStatusChangedEvent(order, currentStatus);
    }

    return {
      previousStatus: currentStatus,
      newStatus: mappedStatus,
      changed: true,
      message: ORDER_MESSAGE.STATUS_UPDATED(mappedStatus),
    };
  }

  private mapGhnStatus(ghnStatus: string): OrderStatus | null {
    const normalized = ghnStatus.toLowerCase();
    if (normalized === "picking" || normalized === "picked") {
      return OrderStatus.SHIPPED;
    }
    if (normalized === "delivering") {
      return OrderStatus.DELIVERING;
    }
    if (normalized === "delivered") {
      return OrderStatus.COMPLETED;
    }
    // GHN cancel (cancel / cancelled) + the whole return family
    // (waiting_to_return, return, return_transporting, return_sorting,
    // returning, return_fail, returned) all mean the buyer will not receive the
    // parcel → cancel locally and release the reserved stock.
    if (normalized.includes("cancel") || normalized.includes("return")) {
      return OrderStatus.CANCELED;
    }
    // Everything else keeps the local status. The recognised ones are listed in
    // GHN_STATUSES_WITHOUT_LOCAL_STATUS with the reason each has no local
    // equivalent — `delivery_fail` in particular is a failed ATTEMPT, and GHN
    // retries before moving to the return family (GHN-FAIL-01, 2026-08-16).
    return null;
  }

  /**
   * Side effects that must run exactly once when an order reaches COMPLETED:
   * consume the stock reserved at creation and, for COD orders, emit
   * payment_completed. Callers must transition the order row to COMPLETED via a
   * conditional update first, so this runs at most once per order — whether the
   * transition was driven by the GHN delivery webhook or a seller action.
   */
  private async finalizeOrderCompletion(order: Order): Promise<void> {
    for (const item of order.items) {
      await firstValueFrom(
        this.inventoryClient
          .send<boolean>(
            INVENTORY_MESSAGE_PATTERNS.INVENTORY_CONSUME_RESERVED_STOCK,
            {
              productId: item.productId,
              quantity: item.quantity,
              skuId: item.skuId ?? undefined,
              reservationKey: order.reservationKey,
            },
          )
          .pipe(
            timeout(5000),
            catchError((e: unknown) => throwError(() => e)),
          ),
      ).catch((err: unknown) => {
        this.logger.warn(
          `[ORDERS] Consume reserved stock for product ${item.productId}${item.skuId ? ` (SKU ${item.skuId})` : ""} failed: ${String(err)}`,
        );
      });
    }

    if (order.paymentMethod === PaymentMethod.COD) {
      // COD money changes hands at delivery. Stamp it here rather than relying
      // on the fanout below coming back to us — the channel can be unavailable,
      // and paid_at must not depend on RMQ being up.
      // Mirror onto the in-memory entity too: this same object is what the
      // seller's complete/deliver response returns, and it must not report
      // paidAt:null for an order this call just marked paid.
      order.paidAt = (await this.markOrderPaid(order.id)) ?? order.paidAt;
      if (this.fanoutChannel && this.isFanoutChannelLive()) {
        this.fanoutChannel.publish(
          EXCHANGE.PAYMENTS_EXCHANGE,
          EVENT.PAYMENT_COMPLETED_EVENT,
          Buffer.from(
            JSON.stringify({
              data: { orderId: order.id, amount: order.total },
              pattern: EVENT.PAYMENT_COMPLETED_EVENT,
            }),
          ),
        );
      } else {
        this.logger.warn(
          `[ORDERS] RMQ channel unavailable — ${EVENT.PAYMENT_COMPLETED_EVENT} event not published for order ${order.id}`,
        );
      }
      this.logger.log(
        `[ORDERS] payment_completed emitted for COD order ${order.id}`,
      );
    }
  }

  async verifyUserPurchasedProduct(
    userId: number,
    productId: number,
  ): Promise<{ valid: boolean; orderId: number }> {
    const order = await this.orderRepository
      .createQueryBuilder("order")
      .innerJoin("order.items", "item")
      .where(
        "order.userId = :userId AND order.status = :status AND item.productId = :productId",
        { userId, status: OrderStatus.COMPLETED, productId },
      )
      .select(["order.id"])
      .getOne();

    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.PRODUCT_NOT_PURCHASED);
    }

    return { valid: true, orderId: order.id };
  }

  async generateInvoice(
    orderId: number,
    requestingUserId: number,
    requestingUserRole = "user",
  ): Promise<Buffer> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    // Buyer (owner), the order's seller, or an admin may download the invoice.
    const isOwner = Number(order.userId) === requestingUserId;
    const isSeller = Number(order.sellerId) === requestingUserId;
    const isAdmin = requestingUserRole === "admin";
    if (!isOwner && !isSeller && !isAdmin) {
      throw new ForbiddenException(ORDER_MESSAGE.ACCESS_DENIED);
    }
    const buyerProfile = await this.fetchInvoiceParty(Number(order.userId));
    const seller = await this.fetchInvoiceParty(Number(order.sellerId));
    const buyer: InvoiceParty = buyerProfile ?? {
      name: null,
      username: `#${order.userId}`,
      email: null,
    };
    return generateInvoicePdf({
      order: {
        id: order.id,
        status: order.status,
        total: order.total,
        shippingFee: order.shippingFee,
        discountAmount: order.discountAmount,
        voucherCode: order.voucherCode,
        codAmount: order.codAmount,
        paymentMethod: order.paymentMethod,
        shippingAddress: order.shippingAddress,
        createdAt: order.createdAt,
        items: order.items.map((item) => ({
          productId: Number(item.productId),
          productName: item.productName,
          skuLabel: item.skuLabel,
          quantity: item.quantity,
          price: item.price,
        })),
      },
      buyer,
      seller,
    });
  }

  /** Fetch a user profile for the invoice; null if the account is missing. */
  private async fetchInvoiceParty(
    userId: number,
  ): Promise<InvoiceParty | null> {
    const profile = await firstValueFrom(
      this.userClient
        .send<{
          id: number;
          username: string;
          email: string | null;
          name: string | null;
        } | null>(
          { cmd: USER_MESSAGE_PATTERN.GET_USER_INFO },
          { userId, includeEmail: true },
        )
        .pipe(
          timeout(10000),
          catchError((e: unknown) => throwError(() => e)),
        ),
    );
    if (!profile) {
      return null;
    }
    return {
      name: profile.name,
      username: profile.username,
      email: profile.email,
    };
  }

  private async getSellerProductIds(sellerId: number): Promise<number[]> {
    return firstValueFrom(
      this.productClient
        .send<
          number[]
        >(PRODUCT_MESSAGE_PATTERNS.GET_PRODUCT_IDS_BY_SELLER, sellerId)
        .pipe(timeout(10000)),
    );
  }

  /**
   * Given a list of SKU ids, return the subset that is referenced by at least
   * one order item or cart item. Used by the product service to protect SKUs
   * from destructive deletion during a product edit (P0-05).
   */
  async findReferencedSkuIds(skuIds: number[]): Promise<number[]> {
    if (!skuIds || skuIds.length === 0) {
      return [];
    }
    const manager = this.orderItemRepository.manager;
    const [orderItems, cartItems] = await Promise.all([
      manager.find(OrderItem, {
        where: { skuId: In(skuIds) },
        select: ["skuId"],
      }),
      manager.find(CartItem, {
        where: { skuId: In(skuIds) },
        select: ["skuId"],
      }),
    ]);
    const referenced = new Set<number>();
    for (const item of orderItems) {
      if (item.skuId != null) {
        referenced.add(item.skuId);
      }
    }
    for (const item of cartItems) {
      if (item.skuId != null) {
        referenced.add(item.skuId);
      }
    }
    return [...referenced];
  }

  private async verifySellerOwnsOrder(
    orderId: number,
    productIds: number[],
  ): Promise<boolean> {
    const count = await this.orderItemRepository.count({
      where: { orderId, productId: In(productIds) },
    });
    return count > 0;
  }

  async getOrdersBySeller(
    sellerId: number,
    page: number,
    limit: number,
    status?: OrderStatus,
  ): Promise<PaginatedResponse<Order>> {
    const productIds = await this.getSellerProductIds(sellerId);
    if (productIds.length === 0) {
      return PaginatedResponse.of([], 0, page, limit);
    }

    // Items are joined so the seller list carries the same rows the buyer list
    // does — the gateway already enriches them with product images and SKU
    // labels, and without the join every order rendered as `items: []`.
    const qb = this.orderRepository
      .createQueryBuilder("order")
      .leftJoinAndSelect("order.items", "items")
      .where(
        `order.id IN (SELECT DISTINCT order_id FROM order_items WHERE product_id IN (:...productIds))`,
        { productIds },
      );

    if (status) {
      qb.andWhere("order.status = :status", { status });
    }

    const [data, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return PaginatedResponse.of(data, total, page, limit);
  }

  /**
   * A vnpay/zalopay order may not move down the fulfilment path until its money
   * has actually been collected (ORD-GUARD-01). Without this a seller could
   * confirm → ready-to-ship → … → complete an order the buyer abandoned at the
   * payment gateway, and a return on that order would then "refund" money that
   * was never taken. COD is exempt by definition — it is collected on delivery.
   */
  private assertOnlinePaymentSettled(order: Order): void {
    if (order.paymentMethod === PaymentMethod.COD || order.paidAt) {
      return;
    }
    throw new BadRequestException(
      ORDER_MESSAGE.PAYMENT_NOT_COMPLETED(order.paymentMethod),
    );
  }

  async confirmOrder(orderId: number, sellerId: number): Promise<Order> {
    const productIds = await this.getSellerProductIds(sellerId);
    const owns = await this.verifySellerOwnsOrder(orderId, productIds);
    if (!owns) {
      throw new ForbiddenException(ORDER_MESSAGE.ACCESS_DENIED);
    }

    // Items are loaded so the confirm response carries the same order shape as
    // ready-to-ship and GET /order/:id — an empty `items` array reads as "this
    // order lost its items" to a client.
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    this.assertOnlinePaymentSettled(order);
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(ORDER_MESSAGE.CANNOT_CONFIRM(order.status));
    }

    order.status = OrderStatus.CONFIRMED;
    const confirmed = await this.orderRepository.save(order);
    this.publishOrderStatusChangedEvent(confirmed, OrderStatus.PENDING);
    return confirmed;
  }

  async readyToShip(orderId: number, sellerId: number): Promise<Order> {
    const productIds = await this.getSellerProductIds(sellerId);
    const owns = await this.verifySellerOwnsOrder(orderId, productIds);
    if (!owns) {
      throw new ForbiddenException(ORDER_MESSAGE.ACCESS_DENIED);
    }

    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    this.assertOnlinePaymentSettled(order);
    if (order.status !== OrderStatus.CONFIRMED) {
      throw new BadRequestException(
        ORDER_MESSAGE.CANNOT_READY_TO_SHIP(order.status),
      );
    }

    // Create the GHN waybill BEFORE advancing. If GHN order creation fails
    // (GHN rejects the address → 400, GHN down/unreachable → 503), let it
    // propagate and
    // keep the order at CONFIRMED so the seller can fix the address and retry.
    // Never advance to PROCESSING without a waybill — that strands the order
    // (it would look shipped while GHN has no record and can never be synced).
    if (!order.ghnOrderCode) {
      const ghnCode = await this.ghnService.createShippingOrder(order);
      await this.orderRepository.update(order.id, { ghnOrderCode: ghnCode });
      order.ghnOrderCode = ghnCode;
    }

    order.status = OrderStatus.PROCESSING;
    const processing = await this.orderRepository.save(order);
    this.publishOrderStatusChangedEvent(processing, OrderStatus.CONFIRMED);
    return processing;
  }

  /**
   * Forward transitions after PROCESSING. The GHN webhook is the driver; the
   * map exists so an admin can still advance an order by hand when the webhook
   * is unavailable. Only single-step forward moves are allowed — no skipping
   * and no backward moves. Sellers are NOT allowed here (ORD-RBAC-01) — see
   * `advanceOrderStatus`.
   */
  private static readonly ADMIN_FORWARD_TRANSITIONS: Partial<
    Record<OrderStatus, OrderStatus>
  > = {
    [OrderStatus.PROCESSING]: OrderStatus.SHIPPED,
    [OrderStatus.SHIPPED]: OrderStatus.DELIVERING,
    [OrderStatus.DELIVERING]: OrderStatus.COMPLETED,
  };

  /**
   * Owner/admin-scoped order detail with items eagerly loaded. Sellers get a
   * 403 from the buyer-facing GET /order/:id, so this dedicated path verifies
   * ownership (or admin) before returning the full order for enrichment (P1-01).
   */
  async getSellerOrderDetail(
    orderId: number,
    sellerId: number,
    isAdmin: boolean,
  ): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    if (!isAdmin) {
      const productIds = await this.getSellerProductIds(sellerId);
      const owns =
        productIds.length > 0 &&
        (await this.verifySellerOwnsOrder(orderId, productIds));
      if (!owns) {
        throw new ForbiddenException(ORDER_MESSAGE.ACCESS_DENIED);
      }
    }
    return order;
  }

  /**
   * Advance an order one step along the shipping lifecycle
   * (processing → shipped → delivering → completed). Admin-only: the carrier
   * reports these states, not the shop. Concurrency-safe — the status guard on
   * the UPDATE prevents a race with the GHN webhook driving the same
   * transition, so completion side effects run at most once (P1-01).
   */
  async advanceOrderStatus(
    orderId: number,
    sellerId: number,
    isAdmin: boolean,
    targetStatus: OrderStatus,
  ): Promise<Order> {
    // ORD-RBAC-01 — the seller's responsibility ends at ready-to-ship, which
    // always leaves a GHN waybill behind (see `readyToShip`). From there GHN
    // owns the status: letting the shop set it by hand makes the local order
    // disagree with the carrier, and a hand-set terminal status makes the order
    // deaf to the webhook that follows it. A stalled order is recovered from
    // the shipping console (admin GHN sync / demo-status), not by hand here.
    if (!isAdmin) {
      throw new ForbiddenException(ORDER_MESSAGE.SELLER_CANNOT_ADVANCE);
    }

    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }

    this.assertOnlinePaymentSettled(order);

    const currentStatus = order.status ?? OrderStatus.PENDING;
    const expected = OrdersService.ADMIN_FORWARD_TRANSITIONS[currentStatus];
    if (expected !== targetStatus) {
      throw new BadRequestException(
        ORDER_MESSAGE.INVALID_TRANSITION(currentStatus, targetStatus),
      );
    }

    const updateResult = await this.orderRepository.update(
      { id: order.id, status: currentStatus },
      { status: targetStatus },
    );
    if (updateResult.affected !== 1) {
      throw new ConflictException(ORDER_MESSAGE.CONCURRENT_UPDATE(orderId));
    }
    order.status = targetStatus;
    this.logger.log(
      `[ORDERS] Order ${order.id} advanced to ${targetStatus} manually by admin ${sellerId}`,
    );

    if (targetStatus === OrderStatus.COMPLETED) {
      await this.finalizeOrderCompletion(order);
    }
    // Announced after settlement so the buyer is never told "delivered" before
    // the COD payment is recorded — same ordering as the GHN webhook path.
    this.publishOrderStatusChangedEvent(order, currentStatus);
    return order;
  }

  // ----------------------------------------------------------------------------
  // F2 — Buyer-initiated return / refund request lifecycle
  // ----------------------------------------------------------------------------

  /**
   * Buyer opens a return request on an order they have received. Only orders in
   * DELIVERING or COMPLETED are eligible (goods are in the buyer's hands). The
   * order is parked at RETURN_REQUESTED and the seller is notified; the previous
   * status is captured so a rejection can restore it.
   */
  async requestReturn(
    orderId: number,
    userId: number,
    reason: string,
  ): Promise<ReturnRequestView> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    if (Number(order.userId) !== userId) {
      throw new ForbiddenException(ORDER_MESSAGE.RETURN_FORBIDDEN);
    }
    if (
      order.status !== OrderStatus.DELIVERING &&
      order.status !== OrderStatus.COMPLETED
    ) {
      throw new BadRequestException(
        ORDER_MESSAGE.RETURN_NOT_ELIGIBLE(order.status),
      );
    }

    const existing = await this.returnRequestRepository.findOne({
      where: {
        orderId,
        status: In([
          ReturnRequestStatus.PENDING_REVIEW,
          ReturnRequestStatus.APPROVED,
        ]),
      },
    });
    if (existing) {
      throw new ConflictException(ORDER_MESSAGE.RETURN_ALREADY_ACTIVE);
    }

    const saved = await this.returnRequestRepository.save(
      this.returnRequestRepository.create({
        orderId,
        userId,
        publicId: generatePublicId(PUBLIC_ID_PREFIXES.RETURN_REQUEST),
        reason,
        status: ReturnRequestStatus.PENDING_REVIEW,
        previousOrderStatus: order.status ?? null,
      }),
    );

    await this.updateOrderStatus(orderId, OrderStatus.RETURN_REQUESTED);
    this.publishOrderReturnEvent(EVENT.ORDER_RETURN_REQUESTED_EVENT, orderId);
    this.logger.log(
      `[ORDERS] Return request ${saved.id} opened for order ${orderId} by user ${userId}`,
    );
    return { ...saved, orderPublicId: order.publicId };
  }

  /**
   * Seller (order owner) or admin reviews a pending return request. Approve →
   * the order moves to REFUNDED, stock is released, a best-effort GHN return is
   * pushed, and a refund is recorded (simulated for online, manual_pending for
   * COD). Reject → the order is restored to its pre-request status.
   */
  async reviewReturnRequest(
    requestId: number | string,
    reviewerId: number,
    reviewerRole: string,
    decision: "approve" | "reject",
    rejectReason?: string,
  ): Promise<ReturnRequestView> {
    const request = await this.returnRequestRepository.findOne({
      where:
        typeof requestId === "number"
          ? { id: requestId }
          : { publicId: requestId },
    });
    if (!request) {
      throw new NotFoundException(
        ORDER_MESSAGE.RETURN_REQUEST_NOT_FOUND(requestId),
      );
    }
    if (request.status !== ReturnRequestStatus.PENDING_REVIEW) {
      throw new BadRequestException(
        ORDER_MESSAGE.RETURN_ALREADY_REVIEWED(requestId),
      );
    }

    const order = await this.orderRepository.findOne({
      where: { id: request.orderId },
      relations: ["items"],
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(request.orderId));
    }

    if (reviewerRole !== "admin") {
      const productIds = await this.getSellerProductIds(reviewerId);
      const owns =
        productIds.length > 0 &&
        (await this.verifySellerOwnsOrder(request.orderId, productIds));
      if (!owns) {
        throw new ForbiddenException(
          ORDER_MESSAGE.RETURN_REQUEST_ACCESS_DENIED,
        );
      }
    }

    if (decision === "approve") {
      return this.approveReturnRequest(request, order, reviewerId);
    }
    return this.rejectReturnRequest(request, order, reviewerId, rejectReason);
  }

  private async approveReturnRequest(
    request: OrderReturnRequest,
    order: Order,
    reviewerId: number,
  ): Promise<ReturnRequestView> {
    // Best-effort GHN return — non-fatal (sandbox may reject; demo records the
    // refund regardless).
    if (order.ghnOrderCode) {
      try {
        await this.ghnService.returnShippingOrder(order.ghnOrderCode);
      } catch (err) {
        this.logger.warn(
          `[ORDERS] GHN return failed for ${order.ghnOrderCode} on return approval: ${this.toErrorMessage(err)}`,
        );
      }
    }

    // Put the returned units back on the shelf. This must NOT be a reservation
    // release: a COMPLETED order has already had its reservation consumed, so a
    // release silently does nothing and the seller loses that stock forever.
    await this.restockReturnedItems(order.items, order.reservationKey);

    // Simulated refund (DEMO — no real gateway call). COD never captured money
    // through a gateway, so it is flagged for a manual/cash settlement.
    const refundAmount = Number(order.total ?? 0);
    const refundStatus =
      order.paymentMethod === PaymentMethod.COD
        ? RefundStatus.MANUAL_PENDING
        : RefundStatus.REFUNDED;

    await this.updateOrderStatus(order.id, OrderStatus.REFUNDED);

    request.status = ReturnRequestStatus.APPROVED;
    request.reviewedBy = reviewerId;
    request.refundAmount = refundAmount;
    request.refundMethod = order.paymentMethod;
    request.refundStatus = refundStatus;
    const saved = await this.returnRequestRepository.save(request);

    this.publishOrderReturnEvent(EVENT.ORDER_RETURN_APPROVED_EVENT, order.id);
    this.logger.log(
      `[ORDERS] Return request ${request.id} approved for order ${order.id}; refund ${refundAmount} (${refundStatus})`,
    );
    return { ...saved, orderPublicId: order.publicId };
  }

  private async rejectReturnRequest(
    request: OrderReturnRequest,
    order: Order,
    reviewerId: number,
    rejectReason?: string,
  ): Promise<ReturnRequestView> {
    if (!rejectReason || rejectReason.trim().length === 0) {
      throw new BadRequestException(ORDER_MESSAGE.REJECT_REASON_REQUIRED);
    }
    const restoreStatus =
      (request.previousOrderStatus as OrderStatus | null) ??
      OrderStatus.COMPLETED;
    await this.updateOrderStatus(order.id, restoreStatus);

    request.status = ReturnRequestStatus.REJECTED;
    request.reviewedBy = reviewerId;
    request.rejectReason = rejectReason;
    const saved = await this.returnRequestRepository.save(request);

    this.publishOrderReturnEvent(EVENT.ORDER_RETURN_REJECTED_EVENT, order.id);
    this.logger.log(
      `[ORDERS] Return request ${request.id} rejected for order ${order.id}; restored to ${restoreStatus}`,
    );
    return { ...saved, orderPublicId: order.publicId };
  }

  /** Buyer's own return requests, newest first. */
  async getUserReturnRequests(
    userId: number,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<ReturnRequestView>> {
    const [data, total] = await this.returnRequestRepository.findAndCount({
      where: { userId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const enriched = await this.attachOrderPublicIds(data);
    return PaginatedResponse.of(enriched, total, page, limit);
  }

  // PUBID-01 — batch-attach the parent order's public id so return-request
  // rows can deep-link to `/order/:publicId` without exposing the numeric id.
  private async attachOrderPublicIds(
    requests: OrderReturnRequest[],
  ): Promise<ReturnRequestView[]> {
    if (requests.length === 0) {
      return [];
    }
    const orderIds = [
      ...new Set(requests.map((request) => Number(request.orderId))),
    ];
    const orders = await this.orderRepository.find({
      where: { id: In(orderIds) },
      select: { id: true, publicId: true },
    });
    const publicIdByOrderId = new Map(
      orders.map((order) => [order.id, order.publicId]),
    );
    return requests.map((request) => ({
      ...request,
      orderPublicId: publicIdByOrderId.get(Number(request.orderId)) ?? null,
    }));
  }

  /**
   * Return requests a reviewer may act on: admins see all; a seller sees only
   * requests on orders containing their products.
   */
  async getManagedReturnRequests(
    sellerId: number,
    isAdmin: boolean,
    page: number,
    limit: number,
    status?: ReturnRequestStatus,
  ): Promise<PaginatedResponse<ReturnRequestView>> {
    const qb = this.returnRequestRepository.createQueryBuilder("rr");
    if (!isAdmin) {
      const productIds = await this.getSellerProductIds(sellerId);
      if (productIds.length === 0) {
        return PaginatedResponse.of([], 0, page, limit);
      }
      qb.where(
        `rr.order_id IN (SELECT DISTINCT order_id FROM order_items WHERE product_id IN (:...productIds))`,
        { productIds },
      );
    }
    if (status) {
      qb.andWhere("rr.status = :status", { status });
    }
    const [data, total] = await qb
      .orderBy("rr.created_at", "DESC")
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const enriched = await this.attachOrderPublicIds(data);
    return PaginatedResponse.of(enriched, total, page, limit);
  }

  /**
   * Publishes a return-lifecycle event so the notification service can fan out a
   * push to the seller (requested) or buyer (approved/rejected). Mirrors
   * publishOrderCanceledEvent: ORDERS_EXCHANGE fanout + a `pattern` field so the
   * @EventPattern consumer can route it.
   */
  /**
   * Announce a buyer-visible lifecycle move so the notification service can tell
   * the buyer without polling. Best-effort by design: a status transition must
   * never fail because the broker is unavailable — the order state is already
   * committed and the buyer can still read it from the order detail.
   * CANCELED is deliberately NOT published here; it has its own
   * `order_canceled` event and would otherwise notify twice.
   */
  private publishOrderStatusChangedEvent(
    order: Order,
    previousStatus: OrderStatus,
  ): void {
    const eventName = EVENT.ORDER_STATUS_CHANGED_EVENT;
    if (!this.fanoutChannel || !this.isFanoutChannelLive()) {
      this.logger.warn(
        `[ORDERS] RMQ channel unavailable — ${eventName} event not published for order ${order.id}`,
      );
      return;
    }
    try {
      this.fanoutChannel.publish(
        EXCHANGE.ORDERS_EXCHANGE,
        eventName,
        Buffer.from(
          JSON.stringify({
            pattern: eventName,
            data: {
              orderId: Number(order.id),
              publicId: order.publicId ?? null,
              userId: Number(order.userId),
              sellerId: order.sellerId == null ? null : Number(order.sellerId),
              status: order.status,
              previousStatus,
            },
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `[ORDERS] Failed to publish ${eventName} for order ${order.id}: ${String(error)}`,
      );
    }
  }

  private publishOrderReturnEvent(eventName: string, orderId: number): void {
    if (this.fanoutChannel && this.isFanoutChannelLive()) {
      this.fanoutChannel.publish(
        EXCHANGE.ORDERS_EXCHANGE,
        eventName,
        Buffer.from(JSON.stringify({ data: { orderId }, pattern: eventName })),
      );
    } else {
      this.logger.warn(
        `[ORDERS] RMQ channel unavailable — ${eventName} event not published for order ${orderId}`,
      );
    }
  }
}
