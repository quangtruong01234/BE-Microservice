import { Controller, UseFilters } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { HttpToRpcExceptionFilter } from "@app/common/filters/http-to-rpc-exception.filter";
import { CHAT_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { Conversation } from "./entity/conversation.entity";
import { Message } from "./entity/message.entity";
import { ChatService } from "./chat.service";

@UseFilters(new HttpToRpcExceptionFilter())
@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @MessagePattern(CHAT_MESSAGE_PATTERN.CHAT_CREATE_OR_GET_CONVERSATION)
  async createOrGetConversation(
    @Payload() data: { userId: number; otherUserId: number },
  ): Promise<Conversation> {
    return this.chatService.createOrGetConversation(
      data.userId,
      data.otherUserId,
    );
  }

  @MessagePattern(CHAT_MESSAGE_PATTERN.CHAT_GET_CONVERSATIONS)
  async getConversations(
    @Payload() data: { userId: number },
  ): Promise<Conversation[]> {
    return this.chatService.getConversations(data.userId);
  }

  @MessagePattern(CHAT_MESSAGE_PATTERN.CHAT_GET_MESSAGES)
  async getMessages(
    @Payload()
    data: {
      userId: number;
      conversationId: number;
      page: number;
      limit: number;
    },
  ): Promise<{ data: Message[]; total: number; page: number; limit: number }> {
    return this.chatService.getMessages(
      data.userId,
      data.conversationId,
      data.page,
      data.limit,
    );
  }

  @MessagePattern(CHAT_MESSAGE_PATTERN.CHAT_SEND_MESSAGE)
  async sendMessage(
    @Payload()
    data: {
      userId: number;
      dto: {
        conversationId: number;
        content: string;
        parentMessageId?: number;
      };
    },
  ): Promise<Message> {
    return this.chatService.sendMessage(data.userId, data.dto);
  }
}
