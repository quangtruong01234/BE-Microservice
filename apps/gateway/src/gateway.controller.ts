import {
  BadRequestException,
  Controller,
  Post,
  Body,
  Get,
  Query,
} from "@nestjs/common";

import { GatewayService } from "./gateway.service";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RateLimit } from "./common/decorators/rate-limit.decorator";
import { Public } from "./common/decorators/public.decorator";

@ApiTags("Gateway")
@Controller("gateway")
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  @Post()
  // @ApiOperation({ summary: 'Place a new order' })
  // @ApiBody({ type: CreateOrderDto })
  // @ApiResponse({ status: 201, description: 'Order created successfully' })
  async createOrder(@Body() payload: unknown): Promise<unknown> {
    return await this.gatewayService.createOrder(payload);
  }

  @Get("payment-result")
  @Public()
  paymentResult(@Query() query: Record<string, string>): {
    gateway: string;
    status: string;
    transId: string;
    amount: string;
  } {
    let gateway: string;
    let transId: string;

    if (query["apptransid"]) {
      gateway = "zalopay";
      transId = query["apptransid"];
    } else if (query["vnp_TxnRef"]) {
      gateway = "vnpay";
      transId = query["vnp_TxnRef"];
    } else {
      throw new BadRequestException("Missing transaction reference");
    }

    let status: string;
    let amount: string;
    if (gateway === "zalopay") {
      status = query["status"] === "1" ? "success" : "failed";
      amount = query["amount"];
    } else {
      status = query["vnp_ResponseCode"] === "00" ? "success" : "failed";
      amount = query["vnp_Amount"];
    }
    return { gateway, status, transId, amount };
  }

  @Get("health")
  @Public()
  @RateLimit({ limit: 10, ttl: 60 })
  @ApiOperation({ summary: "Health check endpoint" })
  @ApiResponse({
    status: 200,
    description: "Gateway is healthy",
    schema: {
      example: {
        status: "UP",
        timestamp: new Date().toISOString(),
        uptime: 3600,
        memory: { used: 100, total: 512 },
        services: {
          orders: "UP",
          inventory: "UP",
          user: "UP",
          product: "UP",
        },
      },
    },
  })
  @ApiResponse({ status: 429, description: "Too many requests" })
  getHealth() {
    return this.gatewayService.getHeath();
  }
}
