import { Inject, Injectable } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, Observable, timeout } from "rxjs";
import {
  NOTIFICATION_MESSAGE_PATTERN,
  SOCIAL_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { retryOnTransportError } from "../common/exception/transport-error";
import { PaginatedNotifications } from "./notification.types";
import { TCP_TIMEOUT_MS } from "libs/constant/tcp-timeout.constant";

@Injectable()
export class NotificationGatewayService {
  constructor(
    @Inject(NAME_SERVICE_TCP.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.SOCIAL_SERVICE)
    private readonly socialClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
  ) {}

  async exposeReferences<T extends Record<string, unknown>>(
    value: T,
  ): Promise<T> {
    const rows = Array.isArray(value.data)
      ? (value.data as Array<Record<string, unknown>>)
      : [value];
    const postIds = [
      ...new Set(
        rows
          .map((row) => row.postId)
          .filter(
            (postId): postId is number =>
              typeof postId === "number" && Number.isFinite(postId),
          ),
      ),
    ];
    const userIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.userId, row.actorId])
          .filter(
            (userId): userId is number =>
              typeof userId === "number" && Number.isFinite(userId),
          ),
      ),
    ];
    const [posts, users] = await Promise.all([
      postIds.length === 0
        ? Promise.resolve([])
        : firstValueFrom(
            this.socialClient
              .send<
                Array<{ id: number; publicId: string }>
              >(SOCIAL_MESSAGE_PATTERN.GET_POST_PUBLIC_IDS_BY_IDS, postIds)
              .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
          ),
      userIds.length === 0
        ? Promise.resolve([])
        : firstValueFrom(
            this.userClient
              .send<
                Array<{ id: number; publicId?: string | null }>
              >({ cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS }, { userIds })
              .pipe(timeout(TCP_TIMEOUT_MS.WRITE), retryOnTransportError()),
          ),
    ]);
    const postPublicIdById = new Map(
      posts.map((post) => [Number(post.id), post.publicId]),
    );
    const userPublicIdById = new Map(
      users.map((user) => [Number(user.id), user.publicId ?? null]),
    );
    const exposeRow = (
      row: Record<string, unknown>,
    ): Record<string, unknown> => ({
      ...row,
      userId:
        row.userId === null
          ? null
          : (userPublicIdById.get(Number(row.userId)) ?? null),
      postId:
        row.postId === null
          ? null
          : (postPublicIdById.get(Number(row.postId)) ?? null),
      actorId:
        row.actorId === null
          ? null
          : (userPublicIdById.get(Number(row.actorId)) ?? null),
    });
    return (
      Array.isArray(value.data)
        ? { ...value, data: rows.map(exposeRow) }
        : exposeRow(value)
    ) as T;
  }

  async getUserNotifications(
    userId: number,
    page: number,
    limit: number,
  ): Promise<PaginatedNotifications> {
    try {
      const notifications = await firstValueFrom(
        this.notificationClient
          .send(NOTIFICATION_MESSAGE_PATTERN.GET_USER_NOTIFICATIONS, {
            userId,
            page,
            limit,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
          ) as Observable<PaginatedNotifications>,
      );
      return (await this.exposeReferences(
        notifications as unknown as Record<string, unknown>,
      )) as unknown as PaginatedNotifications;
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get user notifications",
        "Notification Service",
      );
    }
  }

  async getUnreadCount(userId: number): Promise<{ unreadCount: number }> {
    try {
      return await firstValueFrom(
        this.notificationClient
          .send(NOTIFICATION_MESSAGE_PATTERN.GET_UNREAD_COUNT, { userId })
          .pipe(
            timeout(TCP_TIMEOUT_MS.READ),
            retryOnTransportError(),
          ) as Observable<{
          unreadCount: number;
        }>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get notification unread count",
        "Notification Service",
      );
    }
  }

  async markNotificationRead(
    notificationId: string,
    userId: number,
  ): Promise<{ success: boolean }> {
    try {
      return await firstValueFrom(
        this.notificationClient
          .send(NOTIFICATION_MESSAGE_PATTERN.MARK_NOTIFICATION_READ, {
            notificationId,
            userId,
          })
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<{
          success: boolean;
        }>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "mark notification read",
        "Notification Service",
      );
    }
  }
}
