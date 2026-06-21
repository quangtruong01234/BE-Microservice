import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { ShippingFeeDto } from "./dto/shipping-fee.dto";
import { GetOrdersByUserQueryDto } from "./dto/get-orders-query.dto";
import { SellerOrdersQueryDto } from "./dto/seller-orders-query.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CheckPermission } from "../common/decorators/check-permission.decorator";

@ApiTags("Order")
@ApiBearerAuth("bearer")
@Controller("order")
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get("admin/orders")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("order", "read:any")
  @ApiOperation({
    summary: "Admin: list all orders with buyer info (paginated)",
  })
  @ApiResponse({ status: 200, description: "Paginated order list with buyer." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — admin only." })
  async getAdminOrders(
    @Query(ValidationPipe) query: GetOrdersByUserQueryDto,
  ): Promise<unknown> {
    return this.orderService.getAdminOrders(query.page ?? 1, query.limit ?? 20);
  }

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

  @Post("shipping-fee")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Calculate GHN shipping fee for an address (requires auth cookie)",
  })
  @ApiBody({ type: ShippingFeeDto })
  @ApiResponse({
    status: 201,
    description: "Shipping fee and expected delivery time.",
  })
  @ApiResponse({ status: 400, description: "Invalid payload." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async calculateShippingFee(
    @Body(ValidationPipe) dto: ShippingFeeDto,
  ): Promise<unknown> {
    return this.orderService.calculateShippingFee(dto);
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

  @Get("seller")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get orders for the logged-in seller" })
  @ApiResponse({
    status: 200,
    description: "Paginated orders containing seller products.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getSellerOrders(
    @Query(ValidationPipe) query: SellerOrdersQueryDto,
    @Req() req: Request,
  ): Promise<unknown> {
    const sellerId = req.user?.id ?? 0;
    return this.orderService.getSellerOrders(sellerId, query);
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
  @ApiResponse({ status: 403, description: "Forbidden — not this user." })
  async getOrderByUser(
    @Param("id") id: string,
    @Query(ValidationPipe) query: GetOrdersByUserQueryDto,
    @Req() req: Request,
  ): Promise<unknown> {
    const callerId = req.user?.id ?? 0;
    const callerRole = req.user?.role ?? "user";
    return await this.orderService.getOrderByUser(
      id,
      query.page ?? 1,
      query.limit ?? 10,
      callerId,
      callerRole,
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
  @ApiResponse({ status: 403, description: "Forbidden — not the order owner." })
  async getPaymentUrl(
    @Param("id") id: string,
    @Req() req: Request,
  ): Promise<{ orderUrl: string | null; status: string | null }> {
    const callerId = req.user?.id ?? 0;
    const callerRole = req.user?.role ?? "user";
    return await this.orderService.getPaymentUrl(+id, callerId, callerRole);
  }

  @Patch(":id/confirm")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Confirm an order (seller only)" })
  @ApiResponse({ status: 200, description: "Order confirmed successfully." })
  @ApiResponse({ status: 400, description: "Order is not in PENDING status." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — not the seller." })
  @ApiResponse({ status: 404, description: "Order not found." })
  async confirmOrder(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const sellerId = req.user?.id ?? 0;
    return this.orderService.confirmOrder(id, sellerId);
  }

  @Patch(":id/ready-to-ship")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Mark an order as ready-to-ship (seller only)" })
  @ApiResponse({
    status: 200,
    description: "Order marked as processing/ready-to-ship.",
  })
  @ApiResponse({
    status: 400,
    description: "Order is not in CONFIRMED status.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — not the seller." })
  @ApiResponse({ status: 404, description: "Order not found." })
  async readyToShip(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const sellerId = req.user?.id ?? 0;
    return this.orderService.readyToShip(id, sellerId);
  }
}
