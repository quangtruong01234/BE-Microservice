import { Controller, Logger } from "@nestjs/common";
import { EventPattern, Payload } from "@nestjs/microservices";
import { EVENT } from "@app/common/constants/event";
import { NotificationWsGateway } from "./notification.ws-gateway";

interface NotificationPayload {
  id: number;
  userId: number;
  type: string;
  orderId: number | null;
  postId: number | null;
  actorId: number | null;
  preview: string | null;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

@Controller()
export class NotificationPushController {
  private readonly logger = new Logger(NotificationPushController.name);

  constructor(private readonly wsGateway: NotificationWsGateway) {}

  @EventPattern(EVENT.NOTIFY_USER_PUSH_EVENT)
  handleNotificationPush(
    @Payload() data: { userId: number; notification: NotificationPayload },
  ): void {
    this.wsGateway.sendToUser(data.userId, data.notification);
    this.logger.log(
      `[NotificationPush] Pushed to userId=${data.userId} type=${data.notification.type}`,
    );
  }
}
