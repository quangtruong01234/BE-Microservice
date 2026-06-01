import { Injectable, Logger } from "@nestjs/common";
import { PaginatedResponse } from "@app/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Notification } from "./entities/notification.entity";
import { NotificationWsGateway } from "./notification.ws-gateway";

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    private readonly wsGateway: NotificationWsGateway,
  ) {}

  async saveNotification(
    userId: number,
    type: string,
    orderId: number,
    message: string,
  ): Promise<void> {
    const notification = this.notificationRepository.create({
      user_id: userId,
      type,
      order_id: orderId,
      message,
    });
    const saved = await this.notificationRepository.save(notification);
    this.wsGateway.sendToUser(userId, saved);
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
      where: { user_id: userId },
      order: { created_at: "DESC" },
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
      { id: notificationId, user_id: userId },
      { is_read: true },
    );
    return { success: true };
  }
}
