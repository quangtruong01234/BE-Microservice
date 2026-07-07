import {
  Controller,
  Inject,
  Logger,
  NotFoundException,
  UseFilters,
} from "@nestjs/common";
import {
  ClientProxy,
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from "@nestjs/microservices";
import { firstValueFrom, Observable, timeout } from "rxjs";
import { NotificationService } from "./notification.service";
import { EVENT } from "@app/common/constants/event";
import { HttpToRpcExceptionFilter, RmqService } from "@app/common";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import {
  NOTIFICATION_MESSAGE_PATTERN,
  ORDER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";

interface OrderInfo {
  id: number;
  userId: number;
  sellerId: number;
  total: number;
}

@UseFilters(HttpToRpcExceptionFilter)
@Controller()
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly rmqService: RmqService,
    @Inject(NAME_SERVICE_TCP.ORDERS_SERVICE)
    private readonly ordersClient: ClientProxy,
  ) {}

  @EventPattern(EVENT.PAYMENT_COMPLETED_EVENT)
  async handlePaymentCompleted(
    @Payload() data: { orderId: number },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const { orderId } = data;
    this.logger.log(
      `[NOTIFICATION] payment_completed received for order ${orderId}`,
    );
    try {
      const order = await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID, orderId)
          .pipe(timeout(10000)) as Observable<OrderInfo>,
      );
      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }
      await this.notificationService.saveNotification(
        order.userId,
        "payment_completed",
        orderId,
        `Đơn hàng #${orderId} đã thanh toán thành công`,
      );
      this.rmqService.ack(context);
    } catch (err) {
      this.logger.error(
        `[NOTIFICATION] handlePaymentCompleted failed for order ${orderId}: ${err}`,
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

  @EventPattern(EVENT.ORDER_CANCELED_EVENT)
  async handleOrderCanceled(
    @Payload() data: { orderId: number },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const { orderId } = data;
    this.logger.log(
      `[NOTIFICATION] order_canceled received for order ${orderId}`,
    );
    try {
      const order = await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID, orderId)
          .pipe(timeout(10000)) as Observable<OrderInfo>,
      );
      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }
      await this.notificationService.saveNotification(
        order.userId,
        "order_canceled",
        orderId,
        `Đơn hàng #${orderId} đã bị hủy`,
      );
      this.rmqService.ack(context);
    } catch (err) {
      this.logger.error(
        `[NOTIFICATION] handleOrderCanceled failed for order ${orderId}: ${err}`,
      );
      const channel = context.getChannelRef() as {
        nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      const originalMsg = context.getMessage();
      if (err instanceof NotFoundException) {
        channel.nack(originalMsg, false, false);
      } else {
        channel.nack(originalMsg, false, true);
      }
    }
  }

  @EventPattern(EVENT.ORDER_RETURN_REQUESTED_EVENT)
  async handleOrderReturnRequested(
    @Payload() data: { orderId: number },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const { orderId } = data;
    this.logger.log(
      `[NOTIFICATION] order_return_requested received for order ${orderId}`,
    );
    try {
      const order = await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID, orderId)
          .pipe(timeout(10000)) as Observable<OrderInfo>,
      );
      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }
      // Notify the seller that a buyer opened a return request to review.
      await this.notificationService.saveNotification(
        order.sellerId,
        "order_return_requested",
        orderId,
        `Đơn hàng #${orderId} có yêu cầu trả hàng cần duyệt`,
      );
      this.rmqService.ack(context);
    } catch (err) {
      this.logger.error(
        `[NOTIFICATION] handleOrderReturnRequested failed for order ${orderId}: ${err}`,
      );
      const channel = context.getChannelRef() as {
        nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      const originalMsg = context.getMessage();
      if (err instanceof NotFoundException) {
        channel.nack(originalMsg, false, false);
      } else {
        channel.nack(originalMsg, false, true);
      }
    }
  }

  @EventPattern(EVENT.ORDER_RETURN_APPROVED_EVENT)
  async handleOrderReturnApproved(
    @Payload() data: { orderId: number },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const { orderId } = data;
    this.logger.log(
      `[NOTIFICATION] order_return_approved received for order ${orderId}`,
    );
    try {
      const order = await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID, orderId)
          .pipe(timeout(10000)) as Observable<OrderInfo>,
      );
      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }
      // Notify the buyer that their return request was approved and refunded.
      await this.notificationService.saveNotification(
        order.userId,
        "order_return_approved",
        orderId,
        `Yêu cầu trả hàng cho đơn #${orderId} đã được duyệt và hoàn tiền`,
      );
      this.rmqService.ack(context);
    } catch (err) {
      this.logger.error(
        `[NOTIFICATION] handleOrderReturnApproved failed for order ${orderId}: ${err}`,
      );
      const channel = context.getChannelRef() as {
        nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      const originalMsg = context.getMessage();
      if (err instanceof NotFoundException) {
        channel.nack(originalMsg, false, false);
      } else {
        channel.nack(originalMsg, false, true);
      }
    }
  }

  @EventPattern(EVENT.ORDER_RETURN_REJECTED_EVENT)
  async handleOrderReturnRejected(
    @Payload() data: { orderId: number },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const { orderId } = data;
    this.logger.log(
      `[NOTIFICATION] order_return_rejected received for order ${orderId}`,
    );
    try {
      const order = await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GET_ORDER_BY_ID, orderId)
          .pipe(timeout(10000)) as Observable<OrderInfo>,
      );
      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }
      // Notify the buyer that their return request was rejected.
      await this.notificationService.saveNotification(
        order.userId,
        "order_return_rejected",
        orderId,
        `Yêu cầu trả hàng cho đơn #${orderId} đã bị từ chối`,
      );
      this.rmqService.ack(context);
    } catch (err) {
      this.logger.error(
        `[NOTIFICATION] handleOrderReturnRejected failed for order ${orderId}: ${err}`,
      );
      const channel = context.getChannelRef() as {
        nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      const originalMsg = context.getMessage();
      if (err instanceof NotFoundException) {
        channel.nack(originalMsg, false, false);
      } else {
        channel.nack(originalMsg, false, true);
      }
    }
  }

  @EventPattern(EVENT.COMMENT_CREATED_EVENT)
  async handleCommentCreated(
    @Payload()
    data: {
      postId: number;
      postOwnerId: number;
      commenterId: number;
      commentId: number;
      preview: string;
    },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const { postId, postOwnerId, commenterId, commentId, preview } = data;
    this.logger.log(
      `[NOTIFICATION] comment_created received commentId=${commentId} owner=${postOwnerId}`,
    );
    try {
      await this.notificationService.saveNotification(
        postOwnerId,
        "comment",
        null,
        "New comment on your post",
        {
          postId,
          actorId: commenterId,
          preview,
        },
      );
      this.rmqService.ack(context);
    } catch (err) {
      this.logger.error(`[NOTIFICATION] handleCommentCreated failed: ${err}`);
      const channel = context.getChannelRef() as {
        nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      channel.nack(context.getMessage(), false, true); // requeue: DB error
    }
  }

  @EventPattern(EVENT.REPLY_CREATED_EVENT)
  async handleReplyCreated(
    @Payload()
    data: {
      postId: number;
      parentCommentId: number;
      commentOwnerId: number;
      replierId: number;
      replyId: number;
      preview: string;
    },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const { postId, commentOwnerId, replierId, replyId, preview } = data;
    this.logger.log(
      `[NOTIFICATION] reply_created received replyId=${replyId} owner=${commentOwnerId}`,
    );
    try {
      await this.notificationService.saveNotification(
        commentOwnerId,
        "reply",
        null,
        "New reply to your comment",
        {
          postId,
          actorId: replierId,
          preview,
        },
      );
      this.rmqService.ack(context);
    } catch (err) {
      this.logger.error(`[NOTIFICATION] handleReplyCreated failed: ${err}`);
      const channel = context.getChannelRef() as {
        nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      channel.nack(context.getMessage(), false, true); // requeue: DB error
    }
  }

  @EventPattern(EVENT.BRAND_REVIEWED_EVENT)
  async handleBrandReviewed(
    @Payload()
    data: {
      submittedBy: number;
      brandId: number;
      brandName: string;
      action: "approve" | "reject";
      note: string | null;
    },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const { submittedBy, brandName, action, note } = data;
    if (submittedBy == null) {
      this.rmqService.ack(context);
      return;
    }
    this.logger.log(
      `[NOTIFICATION] brand_reviewed received brand="${brandName}" action=${action} user=${submittedBy}`,
    );
    const message =
      action === "approve"
        ? `Your brand '${brandName}' has been approved.`
        : `Your brand '${brandName}' was rejected.${note ? ` Reason: ${note}` : ""}`;
    try {
      await this.notificationService.saveNotification(
        submittedBy,
        action === "approve" ? "brand_approved" : "brand_rejected",
        null,
        message,
      );
      this.rmqService.ack(context);
    } catch (err) {
      this.logger.error(`[NOTIFICATION] handleBrandReviewed failed: ${err}`);
      const channel = context.getChannelRef() as {
        nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      channel.nack(context.getMessage(), false, true);
    }
  }

  @EventPattern(EVENT.CATEGORY_REVIEWED_EVENT)
  async handleCategoryReviewed(
    @Payload()
    data: {
      submittedBy: number;
      categoryId: number;
      categoryName: string;
      action: "approve" | "reject";
      note: string | null;
    },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const { submittedBy, categoryName, action, note } = data;
    if (submittedBy == null) {
      this.rmqService.ack(context);
      return;
    }
    this.logger.log(
      `[NOTIFICATION] category_reviewed received category="${categoryName}" action=${action} user=${submittedBy}`,
    );
    const message =
      action === "approve"
        ? `Your category '${categoryName}' has been approved.`
        : `Your category '${categoryName}' was rejected.${note ? ` Reason: ${note}` : ""}`;
    try {
      await this.notificationService.saveNotification(
        submittedBy,
        action === "approve" ? "category_approved" : "category_rejected",
        null,
        message,
      );
      this.rmqService.ack(context);
    } catch (err) {
      this.logger.error(`[NOTIFICATION] handleCategoryReviewed failed: ${err}`);
      const channel = context.getChannelRef() as {
        nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      channel.nack(context.getMessage(), false, true);
    }
  }

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERN.GET_USER_NOTIFICATIONS)
  async getUserNotifications(
    @Payload()
    data: {
      userId: number;
      page: number;
      limit: number;
    },
  ): Promise<{
    data: unknown[];
    total: number;
    page: number;
    limit: number;
  }> {
    return this.notificationService.getUserNotifications(
      data.userId,
      data.page,
      data.limit,
    );
  }

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERN.GET_UNREAD_COUNT)
  async getUnreadCount(
    @Payload() data: { userId: number },
  ): Promise<{ unreadCount: number }> {
    return this.notificationService.countUnread(data.userId);
  }

  @MessagePattern(NOTIFICATION_MESSAGE_PATTERN.MARK_NOTIFICATION_READ)
  async markNotificationRead(
    @Payload() data: { notificationId: number; userId: number },
  ): Promise<{ success: boolean }> {
    return this.notificationService.markNotificationRead(
      data.notificationId,
      data.userId,
    );
  }
}
