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
import { EVENT } from "@app/common/constants/event";
import {
  HttpToRpcExceptionFilter,
  PaymentMethod,
  PaginatedResponse,
  RmqService,
} from "@app/common";
import { ORDER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { Order, OrderStatus } from "./entity/order.entity";

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
    },
  ) {
    this.logger.log(
      `[ORDERS] Received create_order request with payload: ${JSON.stringify(payload)}`,
    );
    const { userId, paymentMethod, shippingAddress, items } = payload;
    return await this.ordersService.placeOrder(
      userId,
      paymentMethod,
      shippingAddress,
      items,
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

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_ALL_ORDERS)
  async getAllOrders(
    @Payload() payload: { page: number; limit: number },
  ): Promise<unknown> {
    return this.ordersService.getAllOrders(payload.page, payload.limit);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID)
  async getOrderById(@Payload() orderId: number) {
    return await this.ordersService.getOrderById(orderId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.CANCEL_ORDER)
  async cancelOrder(
    @Payload()
    payload: {
      orderId: number;
      callerId: number;
      callerRole: string;
    },
  ) {
    return await this.ordersService.cancelOrder(
      payload.orderId,
      payload.callerId,
      payload.callerRole,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_ORDER_INVOICE)
  async getOrderInvoice(
    @Payload() data: { orderId: number; requestingUserId: number },
  ): Promise<Buffer> {
    return await this.ordersService.generateInvoice(
      data.orderId,
      data.requestingUserId,
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
    @Payload() data: { orderId: number; sellerId: number },
  ): Promise<Order> {
    return this.ordersService.confirmOrder(data.orderId, data.sellerId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.READY_TO_SHIP)
  async handleReadyToShip(
    @Payload() data: { orderId: number; sellerId: number },
  ): Promise<Order> {
    return this.ordersService.readyToShip(data.orderId, data.sellerId);
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.GET_SELLER_ORDER_DETAIL)
  async handleGetSellerOrderDetail(
    @Payload() data: { orderId: number; sellerId: number; isAdmin: boolean },
  ): Promise<Order> {
    return this.ordersService.getSellerOrderDetail(
      data.orderId,
      data.sellerId,
      data.isAdmin,
    );
  }

  @MessagePattern(ORDER_MESSAGE_PATTERN.ADVANCE_ORDER_STATUS)
  async handleAdvanceOrderStatus(
    @Payload()
    data: {
      orderId: number;
      sellerId: number;
      isAdmin: boolean;
      targetStatus: OrderStatus;
    },
  ): Promise<Order> {
    return this.ordersService.advanceOrderStatus(
      data.orderId,
      data.sellerId,
      data.isAdmin,
      data.targetStatus,
    );
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
