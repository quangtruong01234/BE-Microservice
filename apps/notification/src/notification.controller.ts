import { Controller, Inject, Logger, NotFoundException } from "@nestjs/common";
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
import { RmqService } from "@app/common";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import {
  NOTIFICATION_MESSAGE_PATTERN,
  ORDER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";

interface OrderInfo {
  id: number;
  user_id: number;
  total: number;
}

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
        order.user_id,
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
        order.user_id,
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
