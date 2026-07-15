import {
  Body,
  Controller,
  Get,
  Headers,
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
  ApiHeader,
} from "@nestjs/swagger";
import { CreateOrderDto } from "./dto/create-order.dto";
import { ShippingFeeDto } from "./dto/shipping-fee.dto";
import { GetOrdersByUserQueryDto } from "./dto/get-orders-query.dto";
import { SellerOrdersQueryDto } from "./dto/seller-orders-query.dto";
import { AdminGhnOrdersQueryDto } from "./dto/admin-ghn-orders-query.dto";
import { AnalyticsQueryDto } from "./dto/analytics-query.dto";
import {
  SetGhnDemoStatusDto,
  UpdateGhnCodDto,
  UpdateGhnReceiverDto,
} from "./dto/admin-ghn-update.dto";
import {
  CreateReturnRequestDto,
  RejectReturnRequestDto,
  ReturnRequestsQueryDto,
} from "./dto/return-request.dto";
import {
  CreateVoucherDto,
  ValidateVoucherDto,
  VouchersQueryDto,
} from "./dto/voucher.dto";
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

  @Get("admin/ghn/orders")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("shipping", "read:any")
  @ApiOperation({
    summary: "Admin: list GHN/logistics orders for shipping operations",
  })
  @ApiResponse({ status: 200, description: "Paginated GHN order list." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  async getAdminGhnOrders(
    @Query(ValidationPipe) query: AdminGhnOrdersQueryDto,
  ): Promise<unknown> {
    return this.orderService.getAdminGhnOrders(query);
  }

  @Get("admin/ghn/orders/:id/history")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("shipping", "read:any")
  @ApiOperation({
    summary: "Admin: get GHN shipping history for an order",
  })
  @ApiResponse({ status: 200, description: "Shipping history timeline." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Order not found." })
  async getAdminGhnHistory(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<unknown> {
    return this.orderService.getAdminGhnHistory(id);
  }

  @Get("admin/ghn/orders/:id")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("shipping", "read:any")
  @ApiOperation({
    summary: "Admin: get local order and GHN detail for shipping operations",
  })
  @ApiResponse({ status: 200, description: "Local order plus GHN detail." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Order not found." })
  async getAdminGhnOrderDetail(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<unknown> {
    return this.orderService.getAdminGhnOrderDetail(id);
  }

  @Post("admin/ghn/orders/:id/sync")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("shipping", "update:any")
  @ApiOperation({
    summary: "Admin: manually sync local order status from GHN detail",
  })
  @ApiResponse({ status: 201, description: "GHN status synced." })
  @ApiResponse({ status: 400, description: "Missing GHN order code." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Order not found." })
  async syncAdminGhnOrder(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.orderService.syncAdminGhnOrder(id, req.user?.id ?? null);
  }

  @Post("admin/ghn/orders/:id/cancel")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("shipping", "update:any")
  @ApiOperation({
    summary: "Admin: cancel a GHN waybill and cancel the local order",
  })
  @ApiResponse({ status: 201, description: "GHN order canceled." })
  @ApiResponse({
    status: 400,
    description: "Missing GHN order code or action not allowed for status.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Order not found." })
  @ApiResponse({ status: 500, description: "GHN rejected the cancel." })
  async cancelAdminGhnOrder(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.orderService.cancelAdminGhnOrder(id, req.user?.id ?? null);
  }

  @Post("admin/ghn/orders/:id/return")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("shipping", "update:any")
  @ApiOperation({
    summary:
      "Admin: return a GHN waybill to the shop and cancel the local order",
  })
  @ApiResponse({ status: 201, description: "GHN order returned." })
  @ApiResponse({
    status: 400,
    description: "Missing GHN order code or action not allowed for status.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Order not found." })
  @ApiResponse({ status: 500, description: "GHN rejected the return." })
  async returnAdminGhnOrder(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.orderService.returnAdminGhnOrder(id, req.user?.id ?? null);
  }

  @Post("admin/ghn/orders/:id/update-cod")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("shipping", "update:any")
  @ApiOperation({
    summary: "Admin: update the COD amount on a GHN waybill",
  })
  @ApiResponse({ status: 201, description: "GHN COD updated." })
  @ApiResponse({
    status: 400,
    description: "Missing GHN order code or action not allowed for status.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Order not found." })
  @ApiResponse({ status: 500, description: "GHN rejected the COD update." })
  async updateAdminGhnCod(
    @Param("id", ParseIntPipe) id: number,
    @Body(ValidationPipe) body: UpdateGhnCodDto,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.orderService.updateAdminGhnCod(
      id,
      req.user?.id ?? null,
      body.codAmount,
    );
  }

  @Post("admin/ghn/orders/:id/update-receiver")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("shipping", "update:any")
  @ApiOperation({
    summary: "Admin: update the receiver (name/phone/address) on a GHN waybill",
  })
  @ApiResponse({ status: 201, description: "GHN receiver updated." })
  @ApiResponse({
    status: 400,
    description:
      "Missing GHN order code, no fields provided, or action not allowed.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  @ApiResponse({ status: 404, description: "Order not found." })
  @ApiResponse({
    status: 500,
    description: "GHN rejected the receiver update.",
  })
  async updateAdminGhnReceiver(
    @Param("id", ParseIntPipe) id: number,
    @Body(ValidationPipe) body: UpdateGhnReceiverDto,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.orderService.updateAdminGhnReceiver(id, req.user?.id ?? null, {
      toName: body.toName,
      toPhone: body.toPhone,
      toAddress: body.toAddress,
    });
  }

  @Post("admin/ghn/orders/:id/demo-status")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("shipping", "update:any")
  @ApiOperation({
    summary:
      "Admin (DEMO ONLY): simulate a GHN status to drive the local lifecycle",
  })
  @ApiResponse({ status: 201, description: "Demo GHN status applied." })
  @ApiResponse({ status: 400, description: "Invalid GHN status." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({
    status: 403,
    description: "Forbidden, or demo endpoint disabled.",
  })
  @ApiResponse({ status: 404, description: "Order not found." })
  async setDemoGhnStatus(
    @Param("id", ParseIntPipe) id: number,
    @Body(ValidationPipe) body: SetGhnDemoStatusDto,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.orderService.setDemoGhnStatus(
      id,
      req.user?.id ?? null,
      body.ghnStatus,
    );
  }

  @Post()
  @ApiOperation({ summary: "Place a new order (requires auth cookie)" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: false,
    description:
      "Client-generated unique key; retrying with the same key returns the original order instead of creating a duplicate.",
  })
  @ApiBody({ type: CreateOrderDto })
  @ApiResponse({ status: 201, description: "Order placed successfully." })
  @ApiResponse({
    status: 400,
    description: "Insufficient stock or invalid payload.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({
    status: 409,
    description: "A duplicate order request is already being processed.",
  })
  async createOrder(
    @Body(ValidationPipe) dto: CreateOrderDto,
    @Req() req: Request,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return await this.orderService.createOrder(userId, dto, idempotencyKey);
  }

  @Post("voucher/validate")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Buyer: preview a voucher against a basket (returns the discount, does not consume it)",
  })
  @ApiBody({ type: ValidateVoucherDto })
  @ApiResponse({
    status: 201,
    description: "Voucher is valid — discount and final subtotal returned.",
  })
  @ApiResponse({ status: 400, description: "Voucher not applicable." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 404, description: "Voucher not found or inactive." })
  async validateVoucher(
    @Body(ValidationPipe) dto: ValidateVoucherDto,
    @Req() req: Request,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.orderService.validateVoucher(userId, dto);
  }

  @Post("admin/vouchers")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("order", "create:any")
  @ApiOperation({ summary: "Admin: create a voucher / discount code" })
  @ApiBody({ type: CreateVoucherDto })
  @ApiResponse({ status: 201, description: "Voucher created." })
  @ApiResponse({ status: 400, description: "Invalid voucher payload." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — admin only." })
  @ApiResponse({ status: 409, description: "Voucher code already exists." })
  async createVoucher(
    @Body(ValidationPipe) dto: CreateVoucherDto,
  ): Promise<unknown> {
    return this.orderService.createVoucher(dto);
  }

  @Get("admin/vouchers")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("order", "read:any")
  @ApiOperation({ summary: "Admin: list vouchers (paginated)" })
  @ApiResponse({ status: 200, description: "Paginated voucher list." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — admin only." })
  async listVouchers(
    @Query(ValidationPipe) query: VouchersQueryDto,
  ): Promise<unknown> {
    return this.orderService.listVouchers(query.page, query.limit);
  }

  @Patch("admin/vouchers/:id/deactivate")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("order", "update:any")
  @ApiOperation({ summary: "Admin: deactivate a voucher" })
  @ApiResponse({ status: 200, description: "Voucher deactivated." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — admin only." })
  @ApiResponse({ status: 404, description: "Voucher not found." })
  async deactivateVoucher(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<unknown> {
    return this.orderService.deactivateVoucher(id);
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
  @ApiOperation({
    summary: "Download PDF invoice for an order (buyer, seller, or admin)",
  })
  @ApiResponse({ status: 200, description: "PDF invoice file." })
  @ApiResponse({
    status: 403,
    description: "Forbidden — not the buyer, seller, or an admin.",
  })
  @ApiResponse({ status: 404, description: "Order not found." })
  async getOrderInvoice(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.user?.id ?? 0;
    const userRole = req.user?.role ?? "user";
    const pdfBuffer = await this.orderService.getOrderInvoice(
      id,
      userId,
      userRole,
    );
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

  @Get("seller/analytics")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Analytics dashboard for the logged-in seller",
    description:
      "Revenue over time, order status distribution, and top products " +
      "scoped to the seller's own orders. Defaults to the last 30 days.",
  })
  @ApiResponse({ status: 200, description: "Seller analytics aggregates." })
  @ApiResponse({ status: 400, description: "Invalid date range." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getSellerAnalytics(
    @Query(ValidationPipe) query: AnalyticsQueryDto,
    @Req() req: Request,
  ): Promise<unknown> {
    const sellerId = req.user?.id ?? 0;
    return this.orderService.getSellerAnalytics(sellerId, query);
  }

  @Get("admin/analytics")
  @UseGuards(JwtAuthGuard)
  @CheckPermission("shipping", "read:any")
  @ApiOperation({
    summary: "Global analytics dashboard (admin / shipping console)",
    description:
      "Revenue over time, order status distribution, and top products " +
      "across all sellers. Defaults to the last 30 days.",
  })
  @ApiResponse({ status: 200, description: "Global analytics aggregates." })
  @ApiResponse({ status: 400, description: "Invalid date range." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden." })
  async getShippingAnalytics(
    @Query(ValidationPipe) query: AnalyticsQueryDto,
  ): Promise<unknown> {
    return this.orderService.getShippingAnalytics(query);
  }

  @Get("seller/:id")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Get a single order detail for a seller (owner or admin), with item image + SKU label",
  })
  @ApiResponse({
    status: 200,
    description: "Order detail with enriched items.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — not the seller." })
  @ApiResponse({ status: 404, description: "Order not found." })
  async getSellerOrderDetail(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const sellerId = req.user?.id ?? 0;
    const isAdmin = (req.user?.role ?? "user") === "admin";
    return this.orderService.getSellerOrderDetail(id, sellerId, isAdmin);
  }

  @Get("return-requests/mine")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Buyer: list my own return/refund requests" })
  @ApiResponse({
    status: 200,
    description: "Paginated list of the buyer's return requests.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getMyReturnRequests(
    @Query(ValidationPipe) query: ReturnRequestsQueryDto,
    @Req() req: Request,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.orderService.getMyReturnRequests(
      userId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get("return-requests")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Seller/admin: list return requests to review (seller sees own orders, admin sees all)",
  })
  @ApiResponse({
    status: 200,
    description: "Paginated list of return requests.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getManagedReturnRequests(
    @Query(ValidationPipe) query: ReturnRequestsQueryDto,
    @Req() req: Request,
  ): Promise<unknown> {
    const sellerId = req.user?.id ?? 0;
    const isAdmin = (req.user?.role ?? "user") === "admin";
    return this.orderService.getManagedReturnRequests(
      sellerId,
      isAdmin,
      query.page ?? 1,
      query.limit ?? 20,
      query.status,
    );
  }

  @Post("return-requests/:id/approve")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Seller/admin: approve a return request (refunds and moves the order to REFUNDED)",
  })
  @ApiResponse({ status: 201, description: "Return request approved." })
  @ApiResponse({
    status: 400,
    description: "Return request already reviewed.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({
    status: 403,
    description: "Forbidden — not the seller/admin.",
  })
  @ApiResponse({ status: 404, description: "Return request not found." })
  async approveReturnRequest(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const reviewerId = req.user?.id ?? 0;
    const reviewerRole = req.user?.role ?? "user";
    return this.orderService.reviewReturnRequest(
      id,
      reviewerId,
      reviewerRole,
      "approve",
    );
  }

  @Post("return-requests/:id/reject")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Seller/admin: reject a return request (restores the order to its previous status)",
  })
  @ApiBody({ type: RejectReturnRequestDto })
  @ApiResponse({ status: 201, description: "Return request rejected." })
  @ApiResponse({
    status: 400,
    description: "Return request already reviewed or missing reject reason.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({
    status: 403,
    description: "Forbidden — not the seller/admin.",
  })
  @ApiResponse({ status: 404, description: "Return request not found." })
  async rejectReturnRequest(
    @Param("id", ParseIntPipe) id: number,
    @Body(ValidationPipe) body: RejectReturnRequestDto,
    @Req() req: Request,
  ): Promise<unknown> {
    const reviewerId = req.user?.id ?? 0;
    const reviewerRole = req.user?.role ?? "user";
    return this.orderService.reviewReturnRequest(
      id,
      reviewerId,
      reviewerRole,
      "reject",
      body.reason,
    );
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get a single order by id (owner or admin only)" })
  @ApiResponse({ status: 200, description: "Order details with items." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — not the order owner." })
  @ApiResponse({ status: 404, description: "Order not found." })
  async getOrderById(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const callerId = req.user?.id ?? 0;
    const callerRole = req.user?.role ?? "user";
    return await this.orderService.getOrderById(id, callerId, callerRole);
  }

  @Get("user/:id/status-counts")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Get per-status order counts for a user (full history, server-side)",
  })
  @ApiResponse({
    status: 200,
    description: "Map of status → count, plus an `all` total.",
  })
  @ApiResponse({ status: 403, description: "Forbidden — not this user." })
  async getOrderStatusCounts(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<Record<string, number>> {
    const callerId = req.user?.id ?? 0;
    const callerRole = req.user?.role ?? "user";
    return this.orderService.getOrderStatusCounts(id, callerId, callerRole);
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
    @Param("id", ParseIntPipe) id: number,
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
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const callerId = req.user?.id ?? 0;
    const callerRole = req.user?.role ?? "user";
    return await this.orderService.cancelOrder(id, callerId, callerRole);
  }

  @Post(":id/return-request")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Buyer: request a return/refund for a received order (delivering/completed)",
  })
  @ApiBody({ type: CreateReturnRequestDto })
  @ApiResponse({ status: 201, description: "Return request created." })
  @ApiResponse({
    status: 400,
    description: "Order is not eligible for a return request.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — not the order owner." })
  @ApiResponse({ status: 404, description: "Order not found." })
  @ApiResponse({
    status: 409,
    description: "An active return request already exists for this order.",
  })
  async requestReturn(
    @Param("id", ParseIntPipe) id: number,
    @Body(ValidationPipe) body: CreateReturnRequestDto,
    @Req() req: Request,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.orderService.requestReturn(id, userId, body.reason);
  }

  @Get(":id/payment-url")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get ZaloPay payment URL for an order" })
  @ApiResponse({ status: 200, description: "Payment URL and status." })
  @ApiResponse({ status: 403, description: "Forbidden — not the order owner." })
  async getPaymentUrl(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<{ orderUrl: string | null; status: string | null }> {
    const callerId = req.user?.id ?? 0;
    const callerRole = req.user?.role ?? "user";
    return await this.orderService.getPaymentUrl(id, callerId, callerRole);
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

  @Patch(":id/ship")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Mark an order as shipped — processing → shipped (seller only)",
  })
  @ApiResponse({ status: 200, description: "Order marked as shipped." })
  @ApiResponse({
    status: 400,
    description: "Order is not in PROCESSING status.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — not the seller." })
  @ApiResponse({ status: 404, description: "Order not found." })
  @ApiResponse({ status: 409, description: "Order was updated concurrently." })
  async shipOrder(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const sellerId = req.user?.id ?? 0;
    const isAdmin = (req.user?.role ?? "user") === "admin";
    return this.orderService.advanceOrderStatus(
      id,
      sellerId,
      isAdmin,
      "shipped",
    );
  }

  @Patch(":id/deliver")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Mark an order as out for delivery — shipped → delivering (seller only)",
  })
  @ApiResponse({ status: 200, description: "Order marked as delivering." })
  @ApiResponse({ status: 400, description: "Order is not in SHIPPED status." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — not the seller." })
  @ApiResponse({ status: 404, description: "Order not found." })
  @ApiResponse({ status: 409, description: "Order was updated concurrently." })
  async deliverOrder(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const sellerId = req.user?.id ?? 0;
    const isAdmin = (req.user?.role ?? "user") === "admin";
    return this.orderService.advanceOrderStatus(
      id,
      sellerId,
      isAdmin,
      "delivering",
    );
  }

  @Patch(":id/complete")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      "Mark an order as completed — delivering → completed (seller only)",
  })
  @ApiResponse({ status: 200, description: "Order marked as completed." })
  @ApiResponse({
    status: 400,
    description: "Order is not in DELIVERING status.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({ status: 403, description: "Forbidden — not the seller." })
  @ApiResponse({ status: 404, description: "Order not found." })
  @ApiResponse({ status: 409, description: "Order was updated concurrently." })
  async completeOrder(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<unknown> {
    const sellerId = req.user?.id ?? 0;
    const isAdmin = (req.user?.role ?? "user") === "admin";
    return this.orderService.advanceOrderStatus(
      id,
      sellerId,
      isAdmin,
      "completed",
    );
  }
}
