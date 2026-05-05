import { Controller, Post, Body, Logger, Get } from "@nestjs/common";
import { GatewayService } from "./gateway.service";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RateLimit } from "./common/decorators/rate-limit.decorator";
import { Public } from "./common/decorators/public.decorator";

@ApiTags("Gateway")
@Controller("gateway")
// @Controller("orders") // test 40
export class GatewayController {
  private readonly logger = new Logger(GatewayController.name);

  constructor(private readonly gatewayService: GatewayService) {}

  @Post()
  // @ApiOperation({ summary: 'Place a new order' })
  // @ApiBody({ type: CreateOrderDto })
  // @ApiResponse({ status: 201, description: 'Order created successfully' })
  async createOrder(@Body() payload: any) {
    return await this.gatewayService.createOrder(payload);
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
  async getHealth() {
    return await this.gatewayService.getHeath();
  }
}
