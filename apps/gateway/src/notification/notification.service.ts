import { Inject, Injectable } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, Observable, timeout } from "rxjs";
import { NOTIFICATION_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import { PaginatedNotifications } from "./notification.types";

@Injectable()
export class NotificationGatewayService {
  constructor(
    @Inject(NAME_SERVICE_TCP.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy,
  ) {}

  async getUserNotifications(
    userId: number,
    page: number,
    limit: number,
  ): Promise<PaginatedNotifications> {
    try {
      return await firstValueFrom(
        this.notificationClient
          .send(NOTIFICATION_MESSAGE_PATTERN.GET_USER_NOTIFICATIONS, {
            userId,
            page,
            limit,
          })
          .pipe(timeout(10000)) as Observable<PaginatedNotifications>,
      );
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
          .pipe(timeout(10000)) as Observable<{ unreadCount: number }>,
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
    notificationId: number,
    userId: number,
  ): Promise<{ success: boolean }> {
    try {
      return await firstValueFrom(
        this.notificationClient
          .send(NOTIFICATION_MESSAGE_PATTERN.MARK_NOTIFICATION_READ, {
            notificationId,
            userId,
          })
          .pipe(timeout(10000)) as Observable<{ success: boolean }>,
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
