import { Controller, Get, Param } from "@nestjs/common";
import { OrderService } from "./order.service";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";

@ApiTags("Order")
@Controller("order")
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get("user/:id")
  @ApiOperation({ summary: "Get orders and user info by user id" })
  @ApiResponse({ status: 200, description: "Order and user info." })
  async getOrderByUser(@Param("id") id: string) {
    return await this.orderService.getOrderByUser(id);
  }
}
