import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Channel } from "amqplib";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, Observable, timeout } from "rxjs";
import {
  generatePublicId,
  isRmqPublisherLive,
  MailerService,
  PaginatedResponse,
} from "@app/common";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import {
  ORDER_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";
import { Notification } from "./entities/notification.entity";
import { NOTIFICATION_TEXT_MAX_LENGTH } from "./notification.constants";
import { NotificationMetadata, UserEmailInfo } from "./notification.types";

function truncateNotificationText(
  text: string | null | undefined,
): string | null {
  return text == null ? null : text.slice(0, NOTIFICATION_TEXT_MAX_LENGTH);
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel | null,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.ORDERS_SERVICE)
    private readonly ordersClient: ClientProxy,
    private readonly mailerService: MailerService,
  ) {}

  /**
   * Best-effort email channel: resolves the user's email over TCP and sends the
   * mail. With `html` it goes out as multipart/alternative, `text` being the
   * fallback every client can render. Never throws — email failure must not
   * nack the RabbitMQ message that triggered it (in-app notification + WS push
   * already saved).
   */
  async emailUser(
    userId: number,
    subject: string,
    text: string,
    html?: string,
  ): Promise<void> {
    try {
      const user = await firstValueFrom(
        this.userClient
          .send(
            { cmd: USER_MESSAGE_PATTERN.GET_USER_INFO },
            { userId, includeEmail: true },
          )
          .pipe(timeout(10000)) as Observable<UserEmailInfo | null>,
      );
      if (!user?.email) {
        this.logger.warn(
          `[NOTIFICATION] emailUser skipped — no email for user ${userId}`,
        );
        return;
      }
      await this.mailerService.sendMail(user.email, subject, text, html);
    } catch (err) {
      this.logger.warn(
        `[NOTIFICATION] emailUser failed for user ${userId}: ${String(err)}`,
      );
    }
  }

  async saveNotification(
    userId: number,
    type: string,
    orderId: number | null,
    message: string,
    metadata: NotificationMetadata = {},
    orderPublicId: string | null = null,
  ): Promise<void> {
    const notification = this.notificationRepository.create({
      publicId: generatePublicId(PUBLIC_ID_PREFIXES.NOTIFICATION),
      userId,
      type,
      orderId,
      message: message.slice(0, NOTIFICATION_TEXT_MAX_LENGTH),
      postId: metadata.postId ?? null,
      actorId: metadata.actorId ?? null,
      preview: truncateNotificationText(metadata.preview),
    });
    const saved = await this.notificationRepository.save(notification);

    if (!this.fanoutChannel || !isRmqPublisherLive(this.fanoutChannel)) {
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
              data: {
                userId,
                notification: this.exposeNotification(saved, orderPublicId),
              },
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
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    const [data, total] = await this.notificationRepository.findAndCount({
      where: { userId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const orderIds = [
      ...new Set(
        data
          .map((notification) => notification.orderId)
          .filter((orderId): orderId is number => orderId !== null)
          .map(Number),
      ),
    ];
    const orders =
      orderIds.length === 0
        ? []
        : await firstValueFrom(
            this.ordersClient
              .send(ORDER_MESSAGE_PATTERN.GET_ORDER_PUBLIC_IDS_BY_IDS, orderIds)
              .pipe(timeout(10000)) as Observable<
              { id: number; publicId: string | null }[]
            >,
          );
    const publicIdByOrderId = new Map(
      orders.map((order) => [Number(order.id), order.publicId]),
    );
    return PaginatedResponse.of(
      data.map((notification) =>
        this.exposeNotification(
          notification,
          notification.orderId === null
            ? null
            : (publicIdByOrderId.get(Number(notification.orderId)) ?? null),
        ),
      ),
      total,
      page,
      limit,
    );
  }

  async countUnread(userId: number): Promise<{ unreadCount: number }> {
    const unreadCount = await this.notificationRepository.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  }

  async markNotificationRead(
    notificationId: number | string,
    userId: number,
  ): Promise<{ success: boolean }> {
    await this.notificationRepository.update(
      typeof notificationId === "number"
        ? { id: notificationId, userId }
        : { publicId: notificationId, userId },
      { isRead: true },
    );
    return { success: true };
  }

  private exposeNotification(
    notification: Notification,
    orderPublicId: string | null,
  ): Record<string, unknown> {
    const exposed: Record<string, unknown> = {
      ...notification,
      id: notification.publicId ?? String(notification.id),
      orderId: notification.orderId === null ? null : orderPublicId,
    };
    delete exposed.publicId;
    return exposed;
  }
}
