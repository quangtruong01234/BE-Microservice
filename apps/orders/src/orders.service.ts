import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Order, OrderStatus, PaymentMethod } from "./entity/order.entity";
import { HttpService } from "@nestjs/axios";
import { ClientProxy } from "@nestjs/microservices";
import { catchError, firstValueFrom, throwError, timeout } from "rxjs";
import { OrderItem } from "./entity/order_item.entity";
import { EVENT } from "@app/common/constants/event";
import { EXCHANGE } from "@app/common/constants/exchange";
import { INVENTORY_MESSAGE_PATTERNS } from "libs/constant/message-pattern-inventory.constant";
import { USER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { generateInvoicePdf } from "./invoice/invoice.generator";
import { GhnService } from "./ghn/ghn.service";
import { Channel } from "amqplib";

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel,
    private readonly httpService: HttpService,
    @Inject(NAME_SERVICE_TCP.INVENTORY_SERVICE)
    private readonly inventoryClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
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
  }

  async placeOrder(
    userId: number,
    payment_method: PaymentMethod,
    shipping_address: string,
    items: Array<{
      product_id: number;
      product_name: string;
      quantity: number;
      price: number;
    }>,
  ): Promise<Order> {
    //1. check stock in inventory
    for (const item of items) {
      const result = await firstValueFrom(
        this.inventoryClient
          .send<{
            available: boolean;
            availableStock: number;
          }>(INVENTORY_MESSAGE_PATTERNS.INVENTORY_CHECK_STOCK, {
            productId: item.product_id,
            quantity: item.quantity,
          })
          .pipe(
            timeout(5000),
            catchError((e: unknown) => throwError(() => e)),
          ),
      );
      if (!result.available) {
        throw new BadRequestException(
          `Insufficient stock for product ${item.product_id}: requested ${item.quantity}, available ${result.availableStock}`,
        );
      }
    }
    const total = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    // Tạo order trước
    const order = await this.orderRepository.save(
      this.orderRepository.create({
        user_id: userId,
        total,
        payment_method,
        shipping_address,
        cod_amount: payment_method === PaymentMethod.COD ? total : null,
      }),
    );
    // Tạo order_items với order_id vừa tạo
    const orderItems = items.map((item) =>
      this.orderItemRepository.create({ ...item, order_id: order.id }),
    );
    await this.orderItemRepository.save(orderItems);
    // Gán items vào order để trả về
    order.items = orderItems;

    // Publish event to EVENT BUS via FANOUT exchange
    const exchangeName = EXCHANGE.ORDERS_EXCHANGE;
    const routingKey = EVENT.ORDER_CREATED_EVENT;

    const eventPayload = {
      data: { ...order, payment_method: order.payment_method },
      pattern: routingKey,
    };

    this.fanoutChannel.publish(
      exchangeName,
      routingKey,
      Buffer.from(JSON.stringify(eventPayload)),
    );

    if (order.payment_method === PaymentMethod.COD) {
      try {
        const ghnCode = await this.ghnService.createShippingOrder(order);
        await this.orderRepository.update(order.id, {
          ghn_order_code: ghnCode,
        });
        order.ghn_order_code = ghnCode;
      } catch (err) {
        this.logger.error(
          `GHN createShippingOrder failed for order ${order.id}: ${err}`,
        );
        // order already saved — return without ghn_order_code, retry later
      }
    }

    return order;
  }

  async getOrdersByUser(
    userId: number,
    page: number = 1,
    limit: number = 10,
  ): Promise<{ data: Order[]; total: number; page: number; limit: number }> {
    const [data, total] = await this.orderRepository.findAndCount({
      where: { user_id: userId },
      relations: ["items"],
      order: { created_at: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async getAllOrders(
    page: number = 1,
    limit: number = 10,
  ): Promise<{ data: Order[]; total: number; page: number; limit: number }> {
    const [data, total] = await this.orderRepository.findAndCount({
      relations: ["items"],
      order: { created_at: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
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
    if (order.payment_method === PaymentMethod.COD) {
      this.logger.log(
        `[ORDERS] payment_completed: COD order ${orderId} already processed by GHN webhook`,
      );
      return;
    }

    // ZaloPay/VNPay: create GHN shipping order (cod_amount = null → 0 in GHN payload)
    try {
      const ghnCode = await this.ghnService.createShippingOrder(order);
      await this.orderRepository.update(order.id, { ghn_order_code: ghnCode });
      order.ghn_order_code = ghnCode;
      this.logger.log(`[ORDERS] GHN order created for ${orderId}: ${ghnCode}`);
    } catch (err) {
      this.logger.error(
        `[ORDERS] GHN createShippingOrder failed for order ${orderId}: ${err}`,
      );
    }

    await this.updateOrderStatus(orderId, OrderStatus.PROCESSING);
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
      order.status !== OrderStatus.PROCESSING
    ) {
      throw new BadRequestException("Order cannot be canceled");
    }

    if (callerRole !== "admin" && Number(order.user_id) !== callerId) {
      throw new ForbiddenException(
        "You do not have permission to cancel this order",
      );
    }

    await this.updateOrderStatus(orderId, OrderStatus.CANCELED);
    order.status = OrderStatus.CANCELED;

    this.fanoutChannel.publish(
      EXCHANGE.ORDERS_EXCHANGE,
      EVENT.ORDER_CANCELED_EVENT,
      Buffer.from(
        JSON.stringify({
          data: { orderId: order.id, items: order.items },
          pattern: EVENT.ORDER_CANCELED_EVENT,
        }),
      ),
    );

    this.logger.log(`[ORDERS] Order ${orderId} canceled by user ${callerId}`);
    return order;
  }

  async handleGhnWebhook(
    ghnOrderCode: string,
    ghnStatus: string,
  ): Promise<void> {
    const order = await this.orderRepository.findOne({
      where: { ghn_order_code: ghnOrderCode },
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

    await this.orderRepository.update(order.id, { status: newStatus });
    this.logger.log(`[GHN] Order ${order.id} status updated to ${newStatus}`);

    if (
      newStatus === OrderStatus.COMPLETED &&
      order.payment_method === PaymentMethod.COD
    ) {
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
      this.logger.log(
        `[GHN] payment_completed emitted for COD order ${order.id}`,
      );
    }
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
    if (Number(order.user_id) !== requestingUserId) {
      throw new ForbiddenException("You do not have access to this order");
    }
    const user = await firstValueFrom(
      this.userClient
        .send<{
          id: number;
          username: string;
          email: string;
          name: string | null;
        }>({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, order.user_id)
        .pipe(
          timeout(10000),
          catchError((e: unknown) => throwError(() => e)),
        ),
    );
    return generateInvoicePdf(order, user);
  }
}
