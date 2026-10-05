import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { Request } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { ParsePublicIdPipe } from "../common/pipes/parse-public-id.pipe";
import { ChatGatewayService } from "./chat.service";
import { CreateConversationDto, GetMessagesQueryDto } from "./dto/chat.dto";

@ApiTags("chat")
@ApiBearerAuth("bearer")
@UseGuards(JwtAuthGuard)
@Controller("chat")
export class ChatController {
  constructor(private readonly chatService: ChatGatewayService) {}

  @Post("conversations")
  async createOrGetConversation(
    @Req() req: Request,
    @Body() dto: CreateConversationDto,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.chatService.createOrGetConversation(userId, dto.otherUserId);
  }

  @Get("conversations")
  async getConversations(@Req() req: Request): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.chatService.getConversations(userId);
  }

  @Get("conversations/:id/messages")
  @RateLimit({ limit: 50 })
  async getMessages(
    @Req() req: Request,
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.CONVERSATION))
    conversationId: string,
    @Query(ValidationPipe) query: GetMessagesQueryDto,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.chatService.getMessages(
      userId,
      conversationId,
      query.page ?? 1,
      query.limit ?? 50,
    );
  }

  @Post("conversations/:id/read")
  async markRead(
    @Req() req: Request,
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.CONVERSATION))
    conversationId: string,
  ): Promise<unknown> {
    const userId = req.user?.id ?? 0;
    return this.chatService.markRead(userId, conversationId);
  }

  /**
   * CHAT-E2E-CLEANUP-01 — the sender hard-deletes their own message: 404 for
   * an unknown or already-deleted id, 403 for anyone but the sender. Replies
   * quoting it keep their content but lose `parentMessageId`. No socket event.
   */
  @Delete("messages/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMessage(
    @Req() req: Request,
    @Param("id", new ParsePublicIdPipe(PUBLIC_ID_PREFIXES.MESSAGE))
    messageId: string,
  ): Promise<void> {
    const userId = req.user?.id ?? 0;
    return this.chatService.deleteMessage(userId, messageId);
  }
}
