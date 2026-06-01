import { Inject, Injectable } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, Observable, timeout } from "rxjs";
import { CHAT_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { MicroserviceErrorHandler } from "../common/exception/microservice-error.handler";

@Injectable()
export class ChatGatewayService {
  constructor(
    @Inject(NAME_SERVICE_TCP.CHAT_SERVICE)
    private readonly chatClient: ClientProxy,
  ) {}

  async createOrGetConversation(
    userId: number,
    otherUserId: number,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.chatClient
          .send(CHAT_MESSAGE_PATTERN.CHAT_CREATE_OR_GET_CONVERSATION, {
            userId,
            otherUserId,
          })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "create or get conversation",
        "Chat Service",
      );
    }
  }

  async getConversations(userId: number): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.chatClient
          .send(CHAT_MESSAGE_PATTERN.CHAT_GET_CONVERSATIONS, { userId })
          .pipe(timeout(10000)) as Observable<unknown>,
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
    conversationId: number,
    page: number,
    limit: number,
  ): Promise<unknown> {
    try {
      return await firstValueFrom(
        this.chatClient
          .send(CHAT_MESSAGE_PATTERN.CHAT_GET_MESSAGES, {
            userId,
            conversationId,
            page,
            limit,
          })
          .pipe(timeout(10000)) as Observable<unknown>,
      );
    } catch (error) {
      MicroserviceErrorHandler.handleError(
        error,
        "get messages",
        "Chat Service",
      );
    }
  }
}
