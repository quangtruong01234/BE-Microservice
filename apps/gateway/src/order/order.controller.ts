import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { Request, Response } from "express";
import { OrderService } from "./order.service";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { CreateOrderDto } from "./dto/create-order.dto";
import { GetOrdersByUserQueryDto } from "./dto/get-orders-query.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

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

  @Get(":id/invoice")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Download PDF invoice for an order (owner only)" })
  @ApiResponse({ status: 200, description: "PDF invoice file." })
  @ApiResponse({ status: 403, description: "Forbidden — not the order owner." })
  @ApiResponse({ status: 404, description: "Order not found." })
  async getOrderInvoice(
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.user?.id ?? 0;
    const pdfBuffer = await this.orderService.getOrderInvoice(+id, userId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="invoice-${id}.pdf"`,
    );
    res.end(pdfBuffer);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get a single order by id (owner or admin only)" })
  @ApiResponse({ status: 200, description: "Order details with items." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — not the order owner." })
  @ApiResponse({ status: 404, description: "Order not found." })
  async getOrderById(
    @Param("id") id: string,
    @Req() req: Request,
  ): Promise<unknown> {
    const callerId = req.user?.id ?? 0;
    const callerRole = req.user?.role ?? "user";
    return await this.orderService.getOrderById(id, callerId, callerRole);
  }

  @Get("user/:id")
  @ApiOperation({ summary: "Get paginated orders for a user" })
  @ApiResponse({
    status: 200,
    description: "Paginated order list with total count.",
  })
  @ApiResponse({ status: 400, description: "Invalid query parameters." })
  async getOrderByUser(
    @Param("id") id: string,
    @Query(ValidationPipe) query: GetOrdersByUserQueryDto,
  ): Promise<unknown> {
    return await this.orderService.getOrderByUser(
      id,
      query.page ?? 1,
      query.limit ?? 10,
    );
  }

  @Patch(":id/cancel")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Cancel an order (owner or admin only)" })
  @ApiResponse({ status: 200, description: "Order canceled successfully." })
  @ApiResponse({
    status: 400,
    description: "Order cannot be canceled (invalid status).",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — not the order owner." })
  @ApiResponse({ status: 404, description: "Order not found." })
  async cancelOrder(
    @Param("id") id: string,
    @Req() req: Request,
  ): Promise<unknown> {
    const callerId = req.user?.id ?? 0;
    const callerRole = req.user?.role ?? "user";
    return await this.orderService.cancelOrder(+id, callerId, callerRole);
  }

  @Get(":id/payment-url")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get ZaloPay payment URL for an order" })
  @ApiResponse({ status: 200, description: "Payment URL and status." })
  async getPaymentUrl(
    @Param("id") id: string,
  ): Promise<{ order_url: string | null; status: string | null }> {
    return await this.orderService.getPaymentUrl(+id);
  }
}
