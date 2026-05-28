import { Controller, Logger } from "@nestjs/common";
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from "@nestjs/microservices";
import { OrdersService } from "./orders.service";
import { CMD } from "@app/common/constants/cmd";
import { EVENT } from "@app/common/constants/event";
import { OrderStatus, PaymentMethod } from "./entity/order.entity";
import { RmqService } from "@app/common";
import { ORDER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";

@Controller("orders")
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);
  constructor(
    private readonly ordersService: OrdersService,
    private readonly rmqService: RmqService,
  ) {}

  @MessagePattern({ cmd: CMD.CREATE_ORDER })
  async createOrder(
    @Payload()
    payload: {
      userId: number;
      payment_method: PaymentMethod;
      shipping_address: string;
      items: {
        product_id: number;
        product_name: string;
        quantity: number;
        price: number;
      }[];
    },
  ) {
    this.logger.log(
      `[ORDERS] Received create_order request with payload: ${JSON.stringify(payload)}`,
    );
    const { userId, payment_method, shipping_address, items } = payload;
    return await this.ordersService.placeOrder(
      userId,
      payment_method,
      shipping_address,
      items,
    );
  }

  @MessagePattern("get_orders_by_user")
  async getOrdersByUser(
    @Payload() payload: { userId: number; page: number; limit: number },
  ) {
    return await this.ordersService.getOrdersByUser(
      payload.userId,
      payload.page,
      payload.limit,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID)
  async getOrderById(@Payload() orderId: number) {
    return await this.ordersService.getOrderById(orderId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.CANCEL_ORDER)
  async cancelOrder(
    @Payload()
    payload: {
      orderId: number;
      callerId: number;
      callerRole: string;
    },
  ) {
    return await this.ordersService.cancelOrder(
      payload.orderId,
      payload.callerId,
      payload.callerRole,
    );
  }

  @MessagePattern({ cmd: ORDER_MESSAGE_PATTERN.GET_ORDER_INVOICE })
  async getOrderInvoice(
    @Payload() data: { orderId: number; requestingUserId: number },
  ): Promise<Buffer> {
    return await this.ordersService.generateInvoice(
      data.orderId,
      data.requestingUserId,
    );
  }

  @EventPattern(EVENT.PAYMENT_COMPLETED_EVENT)
  async handlePaymentCompleted(
    @Payload() data: { orderId: number },
    @Ctx() context: RmqContext,
  ) {
    const orderId = data.orderId;
    this.logger.log(`[ORDERS] payment_completed received for order ${orderId}`);
    await this.ordersService.updateOrderStatus(orderId, OrderStatus.COMPLETED);
    this.rmqService.ack(context);
  }
}
