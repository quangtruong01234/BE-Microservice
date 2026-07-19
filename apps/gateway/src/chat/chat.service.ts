import { Inject, Injectable } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, Observable, timeout } from "rxjs";
import {
  CHAT_MESSAGE_PATTERN,
  USER_MESSAGE_PATTERN,
} from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";
import {
  ChatConversationTcp,
  ChatMessageTcp,
  ChatPaginatedTcp,
  ExposedChatConversation,
  ExposedChatMessage,
  exposeChatConversation,
  exposeChatMessage,
} from "./chat.types";
import { TCP_TIMEOUT_MS } from "libs/constant/tcp-timeout.constant";

@Injectable()
export class ChatGatewayService {
  constructor(
    @Inject(NAME_SERVICE_TCP.CHAT_SERVICE)
    private readonly chatClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
  ) {}

  private async resolveUserId(userId: string): Promise<number> {
    const user = await firstValueFrom(
      this.userClient
        .send<{
          id: number;
        }>({ cmd: USER_MESSAGE_PATTERN.GET_USER_INFO }, { userId })
        .pipe(timeout(TCP_TIMEOUT_MS.READ)),
    );
    return Number(user.id);
  }

  private async getUserPublicIdMap(
    userIds: number[],
  ): Promise<Map<number, string>> {
    const uniqueUserIds = [...new Set(userIds.map(Number).filter(Boolean))];
    if (uniqueUserIds.length === 0) return new Map();
    const users = await firstValueFrom(
      this.userClient
        .send<
          Array<{ id: number; publicId?: string | null }>
        >({ cmd: USER_MESSAGE_PATTERN.GET_USERS_BY_IDS }, { userIds: uniqueUserIds })
        .pipe(timeout(TCP_TIMEOUT_MS.READ)),
    );
    return new Map(
      users
        .filter((user) => typeof user.publicId === "string")
        .map((user) => [Number(user.id), user.publicId as string]),
    );
  }

  async exposeMessage(
    message: ChatMessageTcp,
    conversationId: string,
  ): Promise<ExposedChatMessage> {
    const users = await this.getUserPublicIdMap([message.senderId]);
    return exposeChatMessage(message, conversationId, users);
  }

  async createOrGetConversation(
    userId: number,
    otherUserId: string,
  ): Promise<ExposedChatConversation | undefined> {
    try {
      const internalOtherUserId = await this.resolveUserId(otherUserId);
      const conversation = await firstValueFrom(
        this.chatClient
          .send(CHAT_MESSAGE_PATTERN.CHAT_CREATE_OR_GET_CONVERSATION, {
            userId,
            otherUserId: internalOtherUserId,
          })
          .pipe(
            timeout(TCP_TIMEOUT_MS.WRITE),
          ) as Observable<ChatConversationTcp>,
      );
      const users = await this.getUserPublicIdMap([
        conversation.user1Id,
        conversation.user2Id,
        conversation.lastMessage?.senderId ?? 0,
      ]);
      return exposeChatConversation(conversation, users);
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create or get conversation",
        "Chat Service",
      );
    }
  }

  async getConversations(
    userId: number,
  ): Promise<ExposedChatConversation[] | undefined> {
    try {
      const conversations = await firstValueFrom(
        this.chatClient
          .send(CHAT_MESSAGE_PATTERN.CHAT_GET_CONVERSATIONS, { userId })
          .pipe(timeout(TCP_TIMEOUT_MS.READ)) as Observable<
          ChatConversationTcp[]
        >,
      );
      const users = await this.getUserPublicIdMap(
        conversations.flatMap((conversation) => [
          conversation.user1Id,
          conversation.user2Id,
          conversation.lastMessage?.senderId ?? 0,
        ]),
      );
      return conversations.map((conversation) =>
        exposeChatConversation(conversation, users),
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get conversations",
        "Chat Service",
      );
    }
  }

  async getMessages(
    userId: number,
    conversationId: string,
    page: number,
    limit: number,
  ): Promise<
    | (Omit<ChatPaginatedTcp, "data"> & { data: ExposedChatMessage[] })
    | undefined
  > {
    try {
      const messagesPage = await firstValueFrom(
        this.chatClient
          .send(CHAT_MESSAGE_PATTERN.CHAT_GET_MESSAGES, {
            userId,
            conversationId,
            page,
            limit,
          })
          .pipe(timeout(TCP_TIMEOUT_MS.READ)) as Observable<ChatPaginatedTcp>,
      );
      const users = await this.getUserPublicIdMap(
        messagesPage.data.map((message) => message.senderId),
      );
      return {
        ...messagesPage,
        data: messagesPage.data.map((message) =>
          exposeChatMessage(message, conversationId, users),
        ),
      };
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get messages",
        "Chat Service",
      );
    }
  }

  async markRead(userId: number, conversationId: string): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.chatClient
          .send(CHAT_MESSAGE_PATTERN.CHAT_MARK_READ, {
            userId,
            conversationId,
          })
          .pipe(timeout(TCP_TIMEOUT_MS.WRITE)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "mark conversation read",
        "Chat Service",
      );
    }
  }
}
