import {
  Controller,
  Logger,
  NotFoundException,
  UseFilters,
} from "@nestjs/common";
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from "@nestjs/microservices";
import { OrdersService } from "./orders.service";
import type { AnalyticsQuery, OrderAnalytics } from "./orders.types";
import { EVENT } from "@app/common/constants/event";
import {
  HttpToRpcExceptionFilter,
  PaymentMethod,
  PaginatedResponse,
  RmqService,
} from "@app/common";
import { ORDER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { Order, OrderStatus } from "./entity/order.entity";
import { ReturnRequestStatus } from "./entity/order-return-request.entity";
import { VoucherDiscountType } from "./entity/voucher.entity";

@UseFilters(new HttpToRpcExceptionFilter())
@Controller("orders")
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);
  constructor(
    private readonly ordersService: OrdersService,
    private readonly rmqService: RmqService,
  ) {}

  @MessagePattern(ORDER_MESSAGE_PATTERN.CREATE_ORDER)
  async createOrder(
    @Payload()
    payload: {
      userId: number;
      paymentMethod: PaymentMethod;
      shippingAddress: string;
      items: {
        productId: number;
        productName: string;
        quantity: number;
        price: number;
        sellerId?: number;
        skuId?: number | null;
        tierIdx?: number[];
        weight?: number;
      }[];
      voucherCode?: string | null;
    },
  ) {
    this.logger.log(
      `[ORDERS] Received create_order request with payload: ${JSON.stringify(payload)}`,
    );
    const { userId, paymentMethod, shippingAddress, items, voucherCode } =
      payload;
    return await this.ordersService.placeOrder(
      userId,
      paymentMethod,
      shippingAddress,
      items,
      voucherCode,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.CREATE_MULTI_SELLER_ORDER)
  async createMultiSellerOrder(
    @Payload()
    payload: {
      userId: number;
      paymentMethod: PaymentMethod;
      shippingAddress: string;
      items: {
        productId: number;
        productName: string;
        quantity: number;
        price: number;
        sellerId: number;
        skuId?: number | null;
        tierIdx?: number[];
        weight?: number;
      }[];
    },
  ): Promise<Order[]> {
    const { userId, paymentMethod, shippingAddress, items } = payload;
    return this.ordersService.placeMultiSellerOrder(
      userId,
      paymentMethod,
      shippingAddress,
      items,
    );
  }

  @MessagePattern("get_orders_by_user")
  async getOrdersByUser(
    @Payload() payload: { userId: number; page: number; limit: number },
  ) {
    return await this.ordersService.getOrdersByUser(
      payload.userId,
      payload.page,
      payload.limit,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_ORDER_STATUS_COUNTS)
  async getStatusCounts(
    @Payload() userId: number,
  ): Promise<Record<string, number>> {
    return this.ordersService.getStatusCountsByUser(userId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.ANALYTICS)
  async getAnalytics(
    @Payload() query: AnalyticsQuery,
  ): Promise<OrderAnalytics> {
    return this.ordersService.getAnalytics(query);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_ALL_ORDERS)
  async getAllOrders(
    @Payload() payload: { page: number; limit: number },
  ): Promise<unknown> {
    return this.ordersService.getAllOrders(payload.page, payload.limit);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.ADMIN_GHN_ORDERS)
  async getAdminGhnOrders(
    @Payload()
    payload: {
      page: number;
      limit: number;
      status?: string;
      ghnStatus?: string;
      hasGhnCode?: boolean;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ): Promise<unknown> {
    return this.ordersService.getAdminGhnOrders(payload);
  }

  // PUBID-01: HTTP-facing order-id handlers accept the opaque public id
  // (`ord_...`) forwarded by the gateway; internal callers (notification
  // consumers) still send the numeric PK. `resolveOrderId` handles both.

  @MessagePattern(ORDER_MESSAGE_PATTERN.ADMIN_GHN_ORDER_DETAIL)
  async getAdminGhnOrderDetail(
    @Payload() payload: { orderId: number | string },
  ): Promise<unknown> {
    const orderId = await this.ordersService.resolveOrderId(payload.orderId);
    return this.ordersService.getAdminGhnOrderDetail(orderId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.ADMIN_GHN_SYNC)
  async syncAdminGhnOrder(
    @Payload() payload: { orderId: number | string; actorId: number | null },
  ): Promise<unknown> {
    const orderId = await this.ordersService.resolveOrderId(payload.orderId);
    return this.ordersService.syncAdminGhnOrder(orderId, payload.actorId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.ADMIN_GHN_DEMO_STATUS)
  async setDemoGhnStatus(
    @Payload()
    payload: {
      orderId: number | string;
      actorId: number | null;
      ghnStatus: string;
    },
  ): Promise<unknown> {
    const orderId = await this.ordersService.resolveOrderId(payload.orderId);
    return this.ordersService.setDemoGhnStatus(
      orderId,
      payload.actorId,
      payload.ghnStatus,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.ADMIN_GHN_HISTORY)
  async getAdminGhnHistory(
    @Payload() payload: { orderId: number | string },
  ): Promise<unknown> {
    const orderId = await this.ordersService.resolveOrderId(payload.orderId);
    return this.ordersService.getAdminGhnHistory(orderId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.ADMIN_GHN_CANCEL)
  async cancelAdminGhnOrder(
    @Payload() payload: { orderId: number | string; actorId: number | null },
  ): Promise<unknown> {
    const orderId = await this.ordersService.resolveOrderId(payload.orderId);
    return this.ordersService.cancelAdminGhnOrder(orderId, payload.actorId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.ADMIN_GHN_RETURN)
  async returnAdminGhnOrder(
    @Payload() payload: { orderId: number | string; actorId: number | null },
  ): Promise<unknown> {
    const orderId = await this.ordersService.resolveOrderId(payload.orderId);
    return this.ordersService.returnAdminGhnOrder(orderId, payload.actorId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.ADMIN_GHN_UPDATE_COD)
  async updateAdminGhnCod(
    @Payload()
    payload: {
      orderId: number | string;
      actorId: number | null;
      codAmount: number;
    },
  ): Promise<unknown> {
    const orderId = await this.ordersService.resolveOrderId(payload.orderId);
    return this.ordersService.updateAdminGhnCod(
      orderId,
      payload.actorId,
      payload.codAmount,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.ADMIN_GHN_UPDATE_RECEIVER)
  async updateAdminGhnReceiver(
    @Payload()
    payload: {
      orderId: number | string;
      actorId: number | null;
      toName?: string;
      toPhone?: string;
      toAddress?: string;
    },
  ): Promise<unknown> {
    const orderId = await this.ordersService.resolveOrderId(payload.orderId);
    return this.ordersService.updateAdminGhnReceiver(orderId, payload.actorId, {
      toName: payload.toName,
      toPhone: payload.toPhone,
      toAddress: payload.toAddress,
    });
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID)
  async getOrderById(@Payload() orderId: number | string) {
    const resolvedOrderId = await this.ordersService.resolveOrderId(orderId);
    return await this.ordersService.getOrderById(resolvedOrderId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_ORDER_PUBLIC_IDS_BY_IDS)
  async getOrderPublicIdsByIds(
    @Payload() orderIds: number[],
  ): Promise<{ id: number; publicId: string | null }[]> {
    return this.ordersService.getOrderPublicIdsByIds(orderIds);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.CANCEL_ORDER)
  async cancelOrder(
    @Payload()
    payload: {
      orderId: number | string;
      callerId: number;
      callerRole: string;
    },
  ) {
    const orderId = await this.ordersService.resolveOrderId(payload.orderId);
    return await this.ordersService.cancelOrder(
      orderId,
      payload.callerId,
      payload.callerRole,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_ORDER_INVOICE)
  async getOrderInvoice(
    @Payload()
    data: {
      orderId: number | string;
      requestingUserId: number;
      requestingUserRole?: string;
    },
  ): Promise<Buffer> {
    const orderId = await this.ordersService.resolveOrderId(data.orderId);
    return await this.ordersService.generateInvoice(
      orderId,
      data.requestingUserId,
      data.requestingUserRole ?? "user",
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GHN_WEBHOOK)
  async handleGhnWebhook(
    @Payload() payload: { ghnOrderCode: string; ghnStatus: string },
  ): Promise<null> {
    await this.ordersService.handleGhnWebhook(
      payload.ghnOrderCode,
      payload.ghnStatus,
    );
    return null;
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.CALCULATE_SHIPPING_FEE)
  async calculateShippingFee(
    @Payload()
    payload: {
      shippingAddress: string;
      items: {
        productName?: string;
        quantity: number;
        price?: number;
        weight?: number;
      }[];
    },
  ): Promise<{ shippingFee: number; expectedDeliveryTime: string | null }> {
    return this.ordersService.calculateShippingFee(
      payload.shippingAddress,
      payload.items,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.SHIPPING_PROVINCES)
  async listShippingProvinces(): Promise<{ id: number; name: string }[]> {
    return this.ordersService.listShippingProvinces();
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.SHIPPING_DISTRICTS)
  async listShippingDistricts(
    @Payload() payload: { provinceId: number },
  ): Promise<{ id: number; name: string }[]> {
    return this.ordersService.listShippingDistricts(payload.provinceId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.SHIPPING_WARDS)
  async listShippingWards(
    @Payload() payload: { districtId: number },
  ): Promise<{ id: string; name: string }[]> {
    return this.ordersService.listShippingWards(payload.districtId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.VERIFY_PRODUCT_PURCHASED)
  async verifyProductPurchased(
    @Payload() data: { userId: number; productId: number },
  ): Promise<{ valid: boolean; orderId: number }> {
    return this.ordersService.verifyUserPurchasedProduct(
      data.userId,
      data.productId,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_ORDERS_BY_SELLER)
  async handleGetOrdersBySeller(
    @Payload()
    data: {
      sellerId: number;
      page: number;
      limit: number;
      status?: OrderStatus;
    },
  ): Promise<PaginatedResponse<Order>> {
    return this.ordersService.getOrdersBySeller(
      data.sellerId,
      data.page,
      data.limit,
      data.status,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_REFERENCED_SKU_IDS)
  async handleGetReferencedSkuIds(
    @Payload() data: { skuIds: number[] },
  ): Promise<number[]> {
    return this.ordersService.findReferencedSkuIds(data.skuIds);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.CONFIRM_ORDER)
  async handleConfirmOrder(
    @Payload() data: { orderId: number | string; sellerId: number },
  ): Promise<Order> {
    const orderId = await this.ordersService.resolveOrderId(data.orderId);
    return this.ordersService.confirmOrder(orderId, data.sellerId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.READY_TO_SHIP)
  async handleReadyToShip(
    @Payload() data: { orderId: number | string; sellerId: number },
  ): Promise<Order> {
    const orderId = await this.ordersService.resolveOrderId(data.orderId);
    return this.ordersService.readyToShip(orderId, data.sellerId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_SELLER_ORDER_DETAIL)
  async handleGetSellerOrderDetail(
    @Payload()
    data: {
      orderId: number | string;
      sellerId: number;
      isAdmin: boolean;
    },
  ): Promise<Order> {
    const orderId = await this.ordersService.resolveOrderId(data.orderId);
    return this.ordersService.getSellerOrderDetail(
      orderId,
      data.sellerId,
      data.isAdmin,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.ADVANCE_ORDER_STATUS)
  async handleAdvanceOrderStatus(
    @Payload()
    data: {
      orderId: number | string;
      sellerId: number;
      isAdmin: boolean;
      targetStatus: OrderStatus;
    },
  ): Promise<Order> {
    const orderId = await this.ordersService.resolveOrderId(data.orderId);
    return this.ordersService.advanceOrderStatus(
      orderId,
      data.sellerId,
      data.isAdmin,
      data.targetStatus,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.RETURN_REQUEST_CREATE)
  async handleRequestReturn(
    @Payload()
    data: {
      orderId: number | string;
      userId: number;
      reason: string;
    },
  ) {
    const orderId = await this.ordersService.resolveOrderId(data.orderId);
    return this.ordersService.requestReturn(orderId, data.userId, data.reason);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.RETURN_REQUEST_LIST_USER)
  async handleGetUserReturnRequests(
    @Payload() data: { userId: number; page: number; limit: number },
  ) {
    return this.ordersService.getUserReturnRequests(
      data.userId,
      data.page,
      data.limit,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.RETURN_REQUEST_LIST_MANAGED)
  async handleGetManagedReturnRequests(
    @Payload()
    data: {
      sellerId: number;
      isAdmin: boolean;
      page: number;
      limit: number;
      status?: ReturnRequestStatus;
    },
  ) {
    return this.ordersService.getManagedReturnRequests(
      data.sellerId,
      data.isAdmin,
      data.page,
      data.limit,
      data.status,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.RETURN_REQUEST_REVIEW)
  async handleReviewReturnRequest(
    @Payload()
    data: {
      requestId: number | string;
      reviewerId: number;
      reviewerRole: string;
      decision: "approve" | "reject";
      rejectReason?: string;
    },
  ) {
    return this.ordersService.reviewReturnRequest(
      data.requestId,
      data.reviewerId,
      data.reviewerRole,
      data.decision,
      data.rejectReason,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.VOUCHER_VALIDATE)
  async handleValidateVoucher(
    @Payload()
    data: {
      userId: number;
      code: string;
      itemsTotal: number;
    },
  ) {
    return this.ordersService.previewVoucher(
      data.userId,
      data.code,
      data.itemsTotal,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.VOUCHER_CREATE)
  async handleCreateVoucher(
    @Payload()
    data: {
      code: string;
      description?: string | null;
      discountType: VoucherDiscountType;
      discountValue: number;
      minOrderAmount?: number;
      maxDiscountAmount?: number | null;
      usageLimit?: number | null;
      perUserLimit?: number | null;
      startsAt?: string | null;
      expiresAt?: string | null;
      isActive?: boolean;
    },
  ) {
    return this.ordersService.createVoucher(data);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.VOUCHER_LIST)
  async handleListVouchers(@Payload() data: { page: number; limit: number }) {
    return this.ordersService.listVouchers(data.page, data.limit);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.VOUCHER_DEACTIVATE)
  async handleDeactivateVoucher(@Payload() data: { id: number }) {
    return this.ordersService.deactivateVoucher(data.id);
  }

  @EventPattern(EVENT.PAYMENT_COMPLETED_EVENT)
  async handlePaymentCompleted(
    @Payload() data: { orderId: number },
    @Ctx() context: RmqContext,
  ) {
    const orderId = data.orderId;
    this.logger.log(`[ORDERS] payment_completed received for order ${orderId}`);
    try {
      await this.ordersService.handlePaymentCompleted(orderId);
      this.rmqService.ack(context);
    } catch (err) {
      this.logger.error(
        `[ORDERS] handlePaymentCompleted failed for order ${orderId}: ${err}`,
      );
      const channel = context.getChannelRef() as {
        nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      const originalMsg = context.getMessage();
      if (err instanceof NotFoundException) {
        channel.nack(originalMsg, false, false); // no-requeue: order not found
      } else {
        channel.nack(originalMsg, false, true); // requeue: transient error
      }
    }
  }
}
