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
import { OrderStatus } from "./entity/order.entity";
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
      items: { product_id: number; quantity: number; price: number }[];
    },
  ) {
    this.logger.log(
      `[ORDERS] Received create_order request with payload: ${JSON.stringify(payload)}`,
    );
    const { userId, items } = payload;
    return await this.ordersService.placeOrder(userId, items);
  }

  @MessagePattern("get_orders_by_user")
  async getOrdersByUser(@Payload() userId: number) {
    return await this.ordersService.getOrdersByUser(userId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID)
  async getOrderById(@Payload() orderId: number) {
    return await this.ordersService.getOrderById(orderId);
  }

  @EventPattern(EVENT.PAYMENT_COMPLETED_EVENT)
  async handlePaymentCompleted(
    @Payload() data: { data: { orderId: number } },
    @Ctx() context: RmqContext,
  ) {
    const orderId = data.data.orderId;
    this.logger.log(`[ORDERS] payment_completed received for order ${orderId}`);
    await this.ordersService.updateOrderStatus(orderId, OrderStatus.COMPLETED);
    this.rmqService.ack(context);
  }
}
