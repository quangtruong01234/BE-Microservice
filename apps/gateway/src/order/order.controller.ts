import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  ValidationPipe,
} from "@nestjs/common";
import { Request } from "express";
import { OrderService } from "./order.service";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { CreateOrderDto } from "./dto/create-order.dto";

@ApiTags("Order")
@ApiBearerAuth("bearer")
@Controller("order")
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @ApiOperation({ summary: "Place a new order (requires auth cookie)" })
  @ApiBody({ type: CreateOrderDto })
  @ApiResponse({ status: 201, description: "Order placed successfully." })
  @ApiResponse({
    status: 400,
    description: "Insufficient stock or invalid payload.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async createOrder(
    @Body(ValidationPipe) dto: CreateOrderDto,
    @Req() req: Request,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return await this.orderService.createOrder(userId, dto);
  }

  @Get("user/:id")
  @ApiOperation({ summary: "Get orders and user info by user id" })
  @ApiResponse({ status: 200, description: "Order and user info." })
  async getOrderByUser(@Param("id") id: string): Promise<unknown> {
    return await this.orderService.getOrderByUser(id);
  }
}
