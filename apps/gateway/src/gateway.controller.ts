import { Controller, Post, Body, Logger, Get } from "@nestjs/common";
import { GatewayService } from "./gateway.service";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

// @ApiTags("Gateway")
// @Controller("gateway")
@Controller("orders") // test 40
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}
  @Post()
  // @ApiOperation({ summary: 'Place a new order' })
  // @ApiBody({ type: CreateOrderDto })
  // @ApiResponse({ status: 201, description: 'Order created successfully' })
  async createOrder(@Body() payload: any) {
    return await this.gatewayService.createOrder(payload);
  }
}
