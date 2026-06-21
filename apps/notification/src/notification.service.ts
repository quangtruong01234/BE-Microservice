import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Channel } from "amqplib";
import { PaginatedResponse } from "@app/common";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";
import { Notification } from "./entities/notification.entity";

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel | null,
  ) {}

  async saveNotification(
    userId: number,
    type: string,
    orderId: number | null,
    message: string,
  ): Promise<void> {
    const notification = this.notificationRepository.create({
      userId,
      type,
      orderId,
      message,
    });
    const saved = await this.notificationRepository.save(notification);

    if (!this.fanoutChannel) {
      this.logger.warn(
        "[NOTIFICATION] fanoutChannel unavailable — WS push skipped",
      );
    } else {
      try {
        this.fanoutChannel.publish(
          EXCHANGE.NOTIFICATION_PUSH_EXCHANGE,
          "",
          Buffer.from(
            JSON.stringify({
              pattern: EVENT.NOTIFY_USER_PUSH_EVENT,
              data: { userId, notification: saved },
            }),
          ),
        );
      } catch (err) {
        this.logger.warn(
          `[NOTIFICATION] Failed to emit push event: ${String(err)}`,
        );
      }
    }

    this.logger.log(
      `[NOTIFICATION] Saved type=${type} orderId=${orderId} userId=${userId}`,
    );
  }

  async getUserNotifications(
    userId: number,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<Notification>> {
    const [data, total] = await this.notificationRepository.findAndCount({
      where: { userId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return PaginatedResponse.of(data, total, page, limit);
  }

  async markNotificationRead(
    notificationId: number,
    userId: number,
  ): Promise<{ success: boolean }> {
    await this.notificationRepository.update(
      { id: notificationId, userId },
      { isRead: true },
    );
    return { success: true };
  }
}
