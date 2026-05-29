import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
    );
  }

  @Patch(":id/read")
  @ApiOperation({ summary: "Mark a notification as read" })
  @ApiResponse({ status: 200, description: "Notification marked as read." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  async markNotificationRead(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<{ success: boolean }> {
    const userId = req.user?.id ?? 0;
    return this.notificationService.markNotificationRead(id, userId);
  }
}
