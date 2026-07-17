import { Controller, Logger } from "@nestjs/common";
import { Ctx, EventPattern, Payload, RmqContext } from "@nestjs/microservices";
import { EVENT } from "@app/common/constants/event";
import { NotificationWsGateway } from "./notification.ws-gateway";
import { NotificationPayload } from "./notification.types";
import { NotificationGatewayService } from "./notification.service";

@Controller()
export class NotificationPushController {
  private readonly logger = new Logger(NotificationPushController.name);

  constructor(
    private readonly wsGateway: NotificationWsGateway,
    private readonly notificationService: NotificationGatewayService,
  ) {}

  @EventPattern(EVENT.NOTIFY_USER_PUSH_EVENT)
  async handleNotificationPush(
    @Payload() data: { userId: number; notification: NotificationPayload },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as {
      ack: (message: unknown) => void;
      nack: (message: unknown, allUpTo: boolean, requeue: boolean) => void;
    };
    try {
      const notification = await this.notificationService.exposeReferences(
        data.notification as unknown as Record<string, unknown>,
      );
      this.wsGateway.sendToUser(data.userId, notification);
      this.logger.log(
        `[NotificationPush] Pushed to userId=${data.userId} type=${data.notification.type}`,
      );
      channel.ack(context.getMessage());
    } catch (error) {
      this.logger.error(
        `[NotificationPush] Failed for userId=${data.userId}; requeueing`,
        error instanceof Error ? error.stack : String(error),
      );
      channel.nack(context.getMessage(), false, true);
    }
  }
}
