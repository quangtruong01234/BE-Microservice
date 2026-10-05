import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
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
  WishlistAlertEvent,
} from "@app/common";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import {
  ORDER_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";
import { NOTIFICATION_MESSAGE } from "libs/constant/response-message.constant";
import { Notification } from "./entities/notification.entity";
import {
  LIKE_NOTIFICATION_CAS_MAX_ATTEMPTS,
  LIKE_NOTIFICATION_COUNT_PATTERN,
  LIKE_NOTIFICATION_SINGLE_MESSAGE,
  LIKE_NOTIFICATION_TYPE,
  NOTIFICATION_TEXT_MAX_LENGTH,
  WISHLIST_ALERT_NOTIFICATION_TYPES,
  WISHLIST_ALERT_PRODUCT_NAME_MAX_LENGTH,
} from "./notification.constants";
import { NotificationMetadata, UserEmailInfo } from "./notification.types";

function truncateNotificationText(
  text: string | null | undefined,
): string | null {
  return text == null ? null : text.slice(0, NOTIFICATION_TEXT_MAX_LENGTH);
}

export function buildLikeNotificationMessage(likeCount: number): string {
  return likeCount <= 1
    ? LIKE_NOTIFICATION_SINGLE_MESSAGE
    : `${likeCount} people liked your post`;
}

/** Inverse of `buildLikeNotificationMessage`; anything unrecognised counts as 1. */
export function parseLikeNotificationCount(message: string): number {
  const match = LIKE_NOTIFICATION_COUNT_PATTERN.exec(message);
  return match ? Number(match[1]) : 1;
}

function formatPriceVnd(priceVnd: number): string {
  return `${Math.round(priceVnd).toLocaleString("en-US")} VND`;
}

export function buildWishlistAlertMessage(event: WishlistAlertEvent): string {
  const productName = event.productName.slice(
    0,
    WISHLIST_ALERT_PRODUCT_NAME_MAX_LENGTH,
  );
  if (event.kind === "back_in_stock") {
    return `'${productName}' from your wishlist is back in stock.`;
  }
  return event.previousPrice !== null && event.price !== null
    ? `'${productName}' from your wishlist dropped from ${formatPriceVnd(event.previousPrice)} to ${formatPriceVnd(event.price)}.`
    : `'${productName}' from your wishlist dropped in price.`;
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
    this.pushNotification(userId, saved, orderPublicId);

    this.logger.log(
      `[NOTIFICATION] Saved type=${type} orderId=${orderId} userId=${userId}`,
    );
  }

  /**
   * WISHLIST-ALERT-01 — one row per wishlister, saved in ONE transaction so a
   * requeued event can never leave half the batch behind (and then double it).
   * Push is best-effort per row, after the commit.
   */
  async saveWishlistAlerts(event: WishlistAlertEvent): Promise<number> {
    const type = WISHLIST_ALERT_NOTIFICATION_TYPES[event.kind];
    const message = buildWishlistAlertMessage(event).slice(
      0,
      NOTIFICATION_TEXT_MAX_LENGTH,
    );
    const notifications = [...new Set(event.userIds)].map((userId) =>
      this.notificationRepository.create({
        publicId: generatePublicId(PUBLIC_ID_PREFIXES.NOTIFICATION),
        userId,
        type,
        orderId: null,
        message,
        postId: null,
        actorId: null,
        preview: truncateNotificationText(event.productName),
        productPublicId: event.productPublicId,
      }),
    );
    const saved = await this.notificationRepository.save(notifications);
    for (const notification of saved) {
      this.pushNotification(notification.userId, notification, null);
    }
    this.logger.log(
      `[NOTIFICATION] Saved ${saved.length} ${type} for product ${event.productId}`,
    );
    return saved.length;
  }

  /**
   * SOCIAL-LIKE-NTF-01 — fold a like into the owner's single unread `like` row
   * for this post, or open a new one when there is none (the previous one was
   * read, or this is the first like). The update is a compare-and-swap on the
   * message it read, so two racing likes cannot lose a count: the loser
   * re-reads and retries. Only a same-instant FIRST like can still open two
   * rows — there is no unique key to stop it (no migration, by decision).
   */
  async upsertLikeNotification(
    postOwnerId: number,
    postId: number,
    likerId: number,
  ): Promise<void> {
    for (
      let attempt = 1;
      attempt <= LIKE_NOTIFICATION_CAS_MAX_ATTEMPTS;
      attempt++
    ) {
      const unreadLike = await this.notificationRepository.findOne({
        where: {
          userId: postOwnerId,
          type: LIKE_NOTIFICATION_TYPE,
          postId,
          isRead: false,
        },
        order: { id: "DESC" },
      });

      if (!unreadLike) {
        await this.saveNotification(
          postOwnerId,
          LIKE_NOTIFICATION_TYPE,
          null,
          buildLikeNotificationMessage(1),
          { postId, actorId: likerId },
        );
        return;
      }

      // The latest liker again (like → unlike → like) is not a new person.
      if (Number(unreadLike.actorId) === likerId) return;

      const nextMessage = buildLikeNotificationMessage(
        parseLikeNotificationCount(unreadLike.message) + 1,
      );
      const bumpedAt = new Date();
      const swapped = await this.notificationRepository.update(
        { id: unreadLike.id, message: unreadLike.message, isRead: false },
        { message: nextMessage, actorId: likerId, createdAt: bumpedAt },
      );
      if (swapped.affected === 1) {
        this.pushNotification(
          postOwnerId,
          {
            ...unreadLike,
            message: nextMessage,
            actorId: likerId,
            createdAt: bumpedAt,
          },
          null,
        );
        this.logger.log(
          `[NOTIFICATION] Aggregated like postId=${postId} userId=${postOwnerId} — ${nextMessage}`,
        );
        return;
      }
    }
    throw new Error(
      `like notification for post ${postId} kept losing the compare-and-swap`,
    );
  }

  private pushNotification(
    userId: number,
    notification: Notification,
    orderPublicId: string | null,
  ): void {
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
                notification: this.exposeNotification(
                  notification,
                  orderPublicId,
                ),
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
  }

  async getUserNotifications(
    userId: number,
    page: number,
    limit: number,
    isUnreadOnly = false,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    const [data, total] = await this.notificationRepository.findAndCount({
      // NOTIF-INBOX-01: `total` follows the filter, so an unread-only page
      // paginates over unread rows only.
      where: isUnreadOnly ? { userId, isRead: false } : { userId },
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

  /**
   * NOTIF-INBOX-01: flips every unread row of the user in one UPDATE. A like
   * aggregated after this opens a new unread row — the CAS in
   * `upsertLikeNotification` only folds into an unread one.
   */
  async markAllNotificationsRead(
    userId: number,
  ): Promise<{ updatedCount: number }> {
    const updated = await this.notificationRepository.update(
      { userId, isRead: false },
      { isRead: true },
    );
    return { updatedCount: updated.affected ?? 0 };
  }

  /**
   * NOTIF-INBOX-01: hard delete scoped to the owner. Unknown, already deleted
   * and someone else's id are the same 404, so existence never leaks.
   */
  async deleteNotification(
    notificationId: string,
    userId: number,
  ): Promise<null> {
    const deleted = await this.notificationRepository.delete({
      publicId: notificationId,
      userId,
    });
    if (!deleted.affected) {
      throw new NotFoundException(NOTIFICATION_MESSAGE.NOT_FOUND);
    }
    return null;
  }

  /**
   * ACCOUNT-DELETE-01: drops the deleted account's inbox. A notification
   * created after this (e.g. by the order_canceled consumer) survives as an
   * orphan nobody can read — the account can no longer log in.
   */
  async purgeUserData(
    userId: number,
  ): Promise<{ deletedNotificationCount: number }> {
    const deleted = await this.notificationRepository.delete({ userId });
    return { deletedNotificationCount: deleted.affected ?? 0 };
  }

  private exposeNotification(
    notification: Notification,
    orderPublicId: string | null,
  ): Record<string, unknown> {
    const exposed: Record<string, unknown> = {
      ...notification,
      id: notification.publicId ?? String(notification.id),
      orderId: notification.orderId === null ? null : orderPublicId,
      productId: notification.productPublicId ?? null,
    };
    delete exposed.publicId;
    delete exposed.productPublicId;
    return exposed;
  }
}
