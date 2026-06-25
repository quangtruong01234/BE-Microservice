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
import { In, IsNull, LessThan, Repository } from "typeorm";
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
import {
  GhnService,
  GhnShippingItem,
  ShippingFeePreview,
} from "./ghn/ghn.service";
import { Channel } from "amqplib";
import { randomUUID } from "crypto";

type StockReservationItem = {
  productId: number;
  quantity: number;
  skuId?: number | null;
};

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
    }>,
  ): Promise<Order> {
    // Single-seller path: gateway enriches every item with the same sellerId
    const sellerId = items[0]?.sellerId;
    if (!sellerId) {
      throw new BadRequestException("Order items are missing sellerId");
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
          `Insufficient stock for product ${item.productId}: requested ${item.quantity}, available ${result.availableStock}`,
        );
      }
    }
    const itemsTotal = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    // Shipping fee from GHN preview is added to the order total so the
    // payment (COD or gateway) charges goods + shipping in one amount
    const shippingFee = await this.getShippingFeeOrZero(
      shippingAddress,
      paymentMethod === PaymentMethod.COD ? itemsTotal : 0,
      items,
    );
    const total = itemsTotal + shippingFee;
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
          "Payment initialization is temporarily unavailable",
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
          `Insufficient stock for product ${item.productId}: requested ${item.quantity}, available ${result.availableStock}`,
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
              weight: item.weight ?? null,
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
            `Unable to reserve stock for product ${item.productId}`,
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
      throw new ServiceUnavailableException("RabbitMQ publisher unavailable");
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
        `Reservation compensation failed for products: ${failedProductIds.join(", ")}`,
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
      throw new NotFoundException(`Order ${orderId} not found`);
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
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    if (
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.CONFIRMED &&
      order.status !== OrderStatus.PROCESSING
    ) {
      throw new BadRequestException("Order cannot be canceled");
    }

    if (callerRole !== "admin" && Number(order.userId) !== callerId) {
      throw new ForbiddenException(
        "You do not have permission to cancel this order",
      );
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

    let newStatus: OrderStatus;
    const normalized = ghnStatus.toLowerCase();
    if (normalized === "picking" || normalized === "picked") {
      newStatus = OrderStatus.SHIPPED;
    } else if (normalized === "delivering") {
      newStatus = OrderStatus.DELIVERING;
    } else if (normalized === "delivered") {
      newStatus = OrderStatus.COMPLETED;
    } else {
      this.logger.log(
        `[GHN] Unhandled status "${ghnStatus}" for order ${order.id} — skipping`,
      );
      return;
    }

    const currentStatus = order.status ?? OrderStatus.PENDING;
    if (
      currentStatus === OrderStatus.CANCELED ||
      currentStatus === OrderStatus.COMPLETED
    ) {
      this.logger.warn(
        `[GHN] Ignored status "${ghnStatus}" for terminal order ${order.id} (${currentStatus})`,
      );
      return;
    }

    const statusRank: Record<OrderStatus, number> = {
      [OrderStatus.PENDING]: 0,
      [OrderStatus.CONFIRMED]: 1,
      [OrderStatus.PROCESSING]: 2,
      [OrderStatus.SHIPPED]: 3,
      [OrderStatus.DELIVERING]: 4,
      [OrderStatus.COMPLETED]: 5,
      [OrderStatus.CANCELED]: 6,
    };
    if (statusRank[newStatus] <= statusRank[currentStatus]) {
      this.logger.log(
        `[GHN] Ignored duplicate or stale status "${ghnStatus}" for order ${order.id} (${currentStatus})`,
      );
      return;
    }

    const updateResult = await this.orderRepository.update(
      { id: order.id, status: currentStatus },
      { status: newStatus },
    );
    if (updateResult.affected !== 1) {
      this.logger.log(
        `[GHN] Order ${order.id} changed concurrently; webhook "${ghnStatus}" skipped`,
      );
      return;
    }
    this.logger.log(`[GHN] Order ${order.id} status updated to ${newStatus}`);

    // Sale is final on delivery: consume the stock reserved at order creation.
    // The conditional status update above ensures duplicate delivered callbacks
    // cannot consume stock or emit payment completion more than once.
    if (newStatus === OrderStatus.COMPLETED) {
      await this.finalizeOrderCompletion(order);
    }
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
      throw new NotFoundException("Product not found in any completed order");
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
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (Number(order.userId) !== requestingUserId) {
      throw new ForbiddenException("You do not have access to this order");
    }
    const user = await firstValueFrom(
      this.userClient
        .send<{
          id: number;
          username: string;
          email: string;
          name: string | null;
        }>({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, order.userId)
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
      throw new ForbiddenException("You do not have access to this order");
    }

    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        `Order cannot be confirmed — current status: ${order.status}`,
      );
    }

    order.status = OrderStatus.CONFIRMED;
    return this.orderRepository.save(order);
  }

  async readyToShip(orderId: number, sellerId: number): Promise<Order> {
    const productIds = await this.getSellerProductIds(sellerId);
    const owns = await this.verifySellerOwnsOrder(orderId, productIds);
    if (!owns) {
      throw new ForbiddenException("You do not have access to this order");
    }

    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (order.status !== OrderStatus.CONFIRMED) {
      throw new BadRequestException(
        `Order cannot be marked ready-to-ship — current status: ${order.status}`,
      );
    }

    if (!order.ghnOrderCode) {
      try {
        const ghnCode = await this.ghnService.createShippingOrder(order);
        await this.orderRepository.update(order.id, { ghnOrderCode: ghnCode });
        order.ghnOrderCode = ghnCode;
      } catch (err) {
        this.logger.error(
          `[ORDERS] GHN createShippingOrder failed for order ${order.id}: ${err}`,
        );
      }
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
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (!isAdmin) {
      const productIds = await this.getSellerProductIds(sellerId);
      const owns =
        productIds.length > 0 &&
        (await this.verifySellerOwnsOrder(orderId, productIds));
      if (!owns) {
        throw new ForbiddenException("You do not have access to this order");
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
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (!isAdmin) {
      const productIds = await this.getSellerProductIds(sellerId);
      const owns =
        productIds.length > 0 &&
        (await this.verifySellerOwnsOrder(orderId, productIds));
      if (!owns) {
        throw new ForbiddenException("You do not have access to this order");
      }
    }

    const currentStatus = order.status ?? OrderStatus.PENDING;
    const expected = OrdersService.SELLER_FORWARD_TRANSITIONS[currentStatus];
    if (expected !== targetStatus) {
      throw new BadRequestException(
        `Cannot transition order from ${currentStatus} to ${targetStatus}`,
      );
    }

    const updateResult = await this.orderRepository.update(
      { id: order.id, status: currentStatus },
      { status: targetStatus },
    );
    if (updateResult.affected !== 1) {
      throw new ConflictException(
        `Order ${orderId} was updated concurrently; please retry`,
      );
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
}
