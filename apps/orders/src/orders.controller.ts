import { Controller, Logger } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { OrdersService } from "./orders.service";
import { CMD } from "@app/common/constants/cmd";

@Controller("orders")
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);
  constructor(private readonly ordersService: OrdersService) {}

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
}
