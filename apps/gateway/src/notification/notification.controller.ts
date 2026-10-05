import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { Request } from "express";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { NotificationGatewayService } from "./notification.service";
import { GetNotificationsQueryDto } from "./dto/get-notifications-query.dto";
import { ParsePublicIdPipe } from "../common/pipes/parse-public-id.pipe";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";

@ApiTags("Notifications")
@ApiBearerAuth("bearer")
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationGatewayService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Get paginated notifications for the current user" })
  @ApiResponse({ status: 200, description: "Paginated notification list." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getUserNotifications(
    @Req() req: Request,
    @Query(ValidationPipe) query: GetNotificationsQueryDto,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.notificationService.getUserNotifications(
      userId,
      query.page ?? 1,
      query.limit ?? 20,
      query.unreadOnly === true,
    );
  }

  @Get("unread-count")
  @ApiOperation({
    summary: "Get unread notification count for the current user",
  })
  @ApiResponse({ status: 200, description: "Unread notification count." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async getUnreadCount(@Req() req: Request): Promise<{ unreadCount: number }> {
    const userId = req.user?.id ?? 0;
    return this.notificationService.getUnreadCount(userId);
  }

  @Patch("read-all")
  @ApiOperation({
    summary: "Mark every unread notification of the current user as read",
  })
  @ApiResponse({
    status: 200,
    description: "{ updatedCount } — rows flipped; 0 when nothing was unread.",
  })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async markAllNotificationsRead(
    @Req() req: Request,
  ): Promise<{ updatedCount: number }> {
    const userId = req.user?.id ?? 0;
    return this.notificationService.markAllNotificationsRead(userId);
  }

  @Patch(":id/read")
  @ApiOperation({ summary: "Mark a notification as read" })
  @ApiResponse({ status: 200, description: "Notification marked as read." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async markNotificationRead(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.NOTIFICATION))
    id: string,
    @Req() req: Request,
  ): Promise<{ success: boolean }> {
    const userId = req.user?.id ?? 0;
    return this.notificationService.markNotificationRead(id, userId);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete one of the current user's notifications" })
  @ApiResponse({ status: 204, description: "Notification deleted." })
  @ApiResponse({ status: 400, description: "Malformed notification id." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  @ApiResponse({
    status: 404,
    description: "Unknown, already deleted, or another user's notification.",
  })
  async deleteNotification(
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.NOTIFICATION))
    id: string,
    @Req() req: Request,
  ): Promise<void> {
    const userId = req.user?.id ?? 0;
    await this.notificationService.deleteNotification(id, userId);
  }
}
