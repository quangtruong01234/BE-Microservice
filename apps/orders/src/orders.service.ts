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
  Repository,
} from "typeorm";
import { Order, OrderStatus } from "./entity/order.entity";
import { PaymentMethod, PaginatedResponse } from "@app/common";
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
import { generateInvoicePdf } from "./invoice/invoice.generator";
import { GhnService } from "./ghn/ghn.service";
import {
  GhnOrderDetail,
  GhnReceiverUpdate,
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
} from "./orders.types";

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
    @InjectRepository(ShippingHistory)
    private readonly shippingHistoryRepository: Repository<ShippingHistory>,
    @InjectRepository(OrderReturnRequest)
    private readonly returnRequestRepository: Repository<OrderReturnRequest>,
    @InjectRepository(Voucher)
    private readonly voucherRepository: Repository<Voucher>,
    @InjectRepository(VoucherRedemption)
    private readonly voucherRedemptionRepository: Repository<VoucherRedemption>,
    private readonly ghnService: GhnService,
  ) {}

  async onModuleInit() {
    await this.inventoryClient.connect();
    await this.userClient.connect();
    await this.productClient.connect();
  }

  async placeOrder(
    userId: number,
    paymentMethod: PaymentMethod,
    shippingAddress: string,
    items: Array<{
      productId: number;
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
    // Shipping fee from GHN preview is added to the order total so the
    // payment (COD or gateway) charges goods + shipping in one amount
    const shippingFee = await this.getShippingFeeOrZero(
      shippingAddress,
      paymentMethod === PaymentMethod.COD ? itemsTotal : 0,
      items,
    );
    // Discount applies to goods only — never to shipping — and can never drive
    // the total below the shipping fee.
    const total = itemsTotal - discountAmount + shippingFee;
    const reservationKey = randomUUID();
    await this.reserveOrderItems(items, reservationKey);

    let order: Order;
    try {
      order = await this.orderRepository.manager.transaction(
        async (manager) => {
          const savedOrder = await manager.save(
            manager.create(Order, {
              userId,
              sellerId,
              total,
              paymentMethod,
              shippingAddress,
              shippingFee,
              codAmount: paymentMethod === PaymentMethod.COD ? total : null,
              reservationKey,
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
          if (voucherResult) {
            await this.redeemVoucher(
              manager,
              voucherResult.voucher,
              userId,
              savedOrder.id,
              discountAmount,
            );
          }
          savedOrder.items = orderItems;
          return savedOrder;
        },
      );
    } catch (error) {
      await this.releaseReservedItems(items, reservationKey);
      throw error;
    }

    const routingKey = EVENT.ORDER_CREATED_EVENT;
    try {
      this.publishOrderCreatedEvent(order);
    } catch (error) {
      this.logger.warn(
        `[ORDERS] Failed to publish ${EVENT.ORDER_CREATED_EVENT} for order ${order.id}: ${String(error)}`,
      );
      if (order.paymentMethod !== PaymentMethod.COD) {
        await this.cancelOrderAfterPaymentInitializationFailure(order);
        throw new ServiceUnavailableException(
          ORDER_MESSAGE.PAYMENT_INIT_UNAVAILABLE,
        );
      }
      this.logger.warn(
        `[ORDERS] RMQ channel unavailable — ${routingKey} event not published for order ${order.id}`,
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
    return this.voucherRepository.save(voucher);
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
              userId,
              sellerId,
              total,
              paymentMethod,
              shippingAddress,
              shippingFee,
              codAmount: paymentMethod === PaymentMethod.COD ? total : null,
              reservationKey: reservationKeyBySeller.get(sellerId),
            }),
          );

          const orderItems = sellerItems.map((item) =>
            manager.create(OrderItem, {
              orderId: order.id,
              productId: item.productId,
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

    // Emit ORDER_CREATED_EVENT per sub-order after transaction commits
    for (const order of createdOrders) {
      if (this.fanoutChannel) {
        this.fanoutChannel.publish(
          EXCHANGE.ORDERS_EXCHANGE,
          EVENT.ORDER_CREATED_EVENT,
          Buffer.from(
            JSON.stringify({
              pattern: EVENT.ORDER_CREATED_EVENT,
              data: {
                ...order,
                paymentMethod: order.paymentMethod,
                isMultiSellerCheckout: true,
              },
            }),
          ),
        );
      } else {
        this.logger.warn(
          `[ORDERS] RMQ channel unavailable — ${EVENT.ORDER_CREATED_EVENT} event not published for order ${order.id}`,
        );
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

  private publishOrderCreatedEvent(
    order: Order,
    extraData: Record<string, unknown> = {},
  ): void {
    if (!this.fanoutChannel) {
      throw new ServiceUnavailableException(
        ORDER_MESSAGE.RMQ_PUBLISHER_UNAVAILABLE,
      );
    }

    this.fanoutChannel.publish(
      EXCHANGE.ORDERS_EXCHANGE,
      EVENT.ORDER_CREATED_EVENT,
      Buffer.from(
        JSON.stringify({
          pattern: EVENT.ORDER_CREATED_EVENT,
          data: {
            ...order,
            paymentMethod: order.paymentMethod,
            ...extraData,
          },
        }),
      ),
    );
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

  private async getShippingFeeOrZero(
    shippingAddress: string,
    codAmount: number,
    items: Array<{
      productName: string;
      quantity: number;
      price: number;
      weight?: number;
    }>,
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
      );
      return preview.shippingFee;
    } catch (err) {
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

  async getOrdersByUser(
    userId: number,
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponse<Order>> {
    const [data, total] = await this.orderRepository.findAndCount({
      where: { userId },
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

  async getAllOrders(
    page: number = 1,
    limit: number = 10,
  ): Promise<PaginatedResponse<Order>> {
    const [data, total] = await this.orderRepository.findAndCount({
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
      throw new BadRequestException(ORDER_MESSAGE.NO_GHN_ORDER_CODE(orderId));
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
      orderId: order.id,
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
      orderId: order.id,
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
      throw new BadRequestException(ORDER_MESSAGE.NO_GHN_ORDER_CODE(orderId));
    }
    if (!this.getAvailableShippingActions(order).includes(action)) {
      throw new BadRequestException(
        ORDER_MESSAGE.GHN_ACTION_NOT_ALLOWED(action, orderId, order.status),
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
      orderId: order.id,
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
      orderId: order.id,
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
      orderId: order.id,
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
      throw new BadRequestException(ORDER_MESSAGE.NO_GHN_ORDER_CODE(orderId));
    }
    if (!this.getAvailableShippingActions(order).includes(action)) {
      throw new BadRequestException(
        ORDER_MESSAGE.GHN_ACTION_NOT_ALLOWED(action, orderId, order.status),
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
      orderId: order.id,
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
      orderId: order.id,
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
      items: order.items ?? [],
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
      // Cancel: valid while the parcel has not yet entered active delivery.
      if (
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

  async updateOrderStatus(orderId: number, status: OrderStatus): Promise<void> {
    await this.orderRepository.update({ id: orderId }, { status });
    this.logger.log(`[ORDERS] Order ${orderId} status updated to ${status}`);
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

    // Push the cancel to GHN so the shipping order stops too (non-fatal)
    if (order.ghnOrderCode) {
      try {
        await this.ghnService.cancelShippingOrder(order.ghnOrderCode);
        this.logger.log(
          `[ORDERS] GHN shipping order ${order.ghnOrderCode} canceled for order ${order.id}`,
        );
      } catch (err) {
        this.logger.error(
          `[ORDERS] GHN cancel failed for ${order.ghnOrderCode}: ${String(err)}`,
        );
      }
    }

    this.publishOrderCanceledEvent(order);
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
    if (this.fanoutChannel) {
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
      const message = ORDER_MESSAGE.GHN_STATUS_UNHANDLED(ghnStatus);
      this.logger.log(`[GHN] ${message} for order ${order.id} - skipping`);
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
      const message = ORDER_MESSAGE.GHN_STATUS_TERMINAL_IGNORED(
        ghnStatus,
        order.id,
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
        order.id,
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
        order.id,
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
      if (this.fanoutChannel) {
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
  ): Promise<Buffer> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ["items"],
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    if (Number(order.userId) !== requestingUserId) {
      throw new ForbiddenException(ORDER_MESSAGE.ACCESS_DENIED);
    }
    const user = await firstValueFrom(
      this.userClient
        .send<{
          id: number;
          username: string;
          email: string;
          name: string | null;
        }>(
          { cmd: USER_MESSAGE_PATTERN.GET_USER_INFO },
          { userId: Number(order.userId), includeEmail: true },
        )
        .pipe(
          timeout(10000),
          catchError((e: unknown) => throwError(() => e)),
        ),
    );
    return generateInvoicePdf(order, user);
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

    const qb = this.orderRepository
      .createQueryBuilder("order")
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

  async confirmOrder(orderId: number, sellerId: number): Promise<Order> {
    const productIds = await this.getSellerProductIds(sellerId);
    const owns = await this.verifySellerOwnsOrder(orderId, productIds);
    if (!owns) {
      throw new ForbiddenException(ORDER_MESSAGE.ACCESS_DENIED);
    }

    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(ORDER_MESSAGE.NOT_FOUND(orderId));
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(ORDER_MESSAGE.CANNOT_CONFIRM(order.status));
    }

    order.status = OrderStatus.CONFIRMED;
    return this.orderRepository.save(order);
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
    if (order.status !== OrderStatus.CONFIRMED) {
      throw new BadRequestException(
        ORDER_MESSAGE.CANNOT_READY_TO_SHIP(order.status),
      );
    }

    // Create the GHN waybill BEFORE advancing. If GHN order creation fails
    // (unresolvable address → 400, GHN unreachable → 500), let it propagate and
    // keep the order at CONFIRMED so the seller can fix the address and retry.
    // Never advance to PROCESSING without a waybill — that strands the order
    // (it would look shipped while GHN has no record and can never be synced).
    if (!order.ghnOrderCode) {
      const ghnCode = await this.ghnService.createShippingOrder(order);
      await this.orderRepository.update(order.id, { ghnOrderCode: ghnCode });
      order.ghnOrderCode = ghnCode;
    }

    order.status = OrderStatus.PROCESSING;
    return this.orderRepository.save(order);
  }

  /**
   * Seller-driven forward transitions after PROCESSING. The GHN webhook is the
   * primary driver for these; this map lets a seller advance manually when a
   * webhook is delayed or unavailable. Only single-step forward moves are
   * allowed — no skipping and no backward moves.
   */
  private static readonly SELLER_FORWARD_TRANSITIONS: Partial<
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
   * Advance an order one step along the seller lifecycle
   * (processing → shipped → delivering → completed). Concurrency-safe: the
   * status guard on the UPDATE prevents a race with the GHN webhook driving the
   * same transition, so completion side effects run at most once (P1-01).
   */
  async advanceOrderStatus(
    orderId: number,
    sellerId: number,
    isAdmin: boolean,
    targetStatus: OrderStatus,
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

    const currentStatus = order.status ?? OrderStatus.PENDING;
    const expected = OrdersService.SELLER_FORWARD_TRANSITIONS[currentStatus];
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
      `[ORDERS] Order ${order.id} advanced to ${targetStatus} by seller ${sellerId}`,
    );

    if (targetStatus === OrderStatus.COMPLETED) {
      await this.finalizeOrderCompletion(order);
    }
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
  ): Promise<OrderReturnRequest> {
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
    return saved;
  }

  /**
   * Seller (order owner) or admin reviews a pending return request. Approve →
   * the order moves to REFUNDED, stock is released, a best-effort GHN return is
   * pushed, and a refund is recorded (simulated for online, manual_pending for
   * COD). Reject → the order is restored to its pre-request status.
   */
  async reviewReturnRequest(
    requestId: number,
    reviewerId: number,
    reviewerRole: string,
    decision: "approve" | "reject",
    rejectReason?: string,
  ): Promise<OrderReturnRequest> {
    const request = await this.returnRequestRepository.findOne({
      where: { id: requestId },
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
  ): Promise<OrderReturnRequest> {
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

    // Release reserved stock (idempotent via reservationKey). For a DELIVERING
    // order this restores availability; for an already-consumed COMPLETED order
    // it is a safe no-op.
    await this.releaseReservedItems(order.items, order.reservationKey, false);

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
    return saved;
  }

  private async rejectReturnRequest(
    request: OrderReturnRequest,
    order: Order,
    reviewerId: number,
    rejectReason?: string,
  ): Promise<OrderReturnRequest> {
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
    return saved;
  }

  /** Buyer's own return requests, newest first. */
  async getUserReturnRequests(
    userId: number,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<OrderReturnRequest>> {
    const [data, total] = await this.returnRequestRepository.findAndCount({
      where: { userId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return PaginatedResponse.of(data, total, page, limit);
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
  ): Promise<PaginatedResponse<OrderReturnRequest>> {
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
    return PaginatedResponse.of(data, total, page, limit);
  }

  /**
   * Publishes a return-lifecycle event so the notification service can fan out a
   * push to the seller (requested) or buyer (approved/rejected). Mirrors
   * publishOrderCanceledEvent: ORDERS_EXCHANGE fanout + a `pattern` field so the
   * @EventPattern consumer can route it.
   */
  private publishOrderReturnEvent(eventName: string, orderId: number): void {
    if (this.fanoutChannel) {
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
