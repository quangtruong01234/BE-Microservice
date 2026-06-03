import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { Request } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
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
    @Param("id", ParseIntPipe) conversationId: number,
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
}
