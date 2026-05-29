import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Notification } from "./entities/notification.entity";

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
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
    await this.notificationRepository.save(notification);
    this.logger.log(
      `[NOTIFICATION] Saved type=${type} orderId=${orderId} userId=${userId}`,
    );
  }

  async getUserNotifications(
    userId: number,
    page: number,
    limit: number,
  ): Promise<{
    data: Notification[];
    total: number;
    page: number;
    limit: number;
  }> {
    const [data, total] = await this.notificationRepository.findAndCount({
      where: { user_id: userId },
      order: { created_at: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
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
