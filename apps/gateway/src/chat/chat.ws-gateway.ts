import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { ClientProxy } from "@nestjs/microservices";
import { JwtService } from "@nestjs/jwt";
import { firstValueFrom, timeout } from "rxjs";
import { Server, Socket } from "socket.io";
import { CHAT_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { gatewayCorsOptions } from "../common/cors";

@Injectable()
@WebSocketGateway({
  cors: gatewayCorsOptions,
  namespace: "/chat",
})
export class ChatWsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatWsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(NAME_SERVICE_TCP.CHAT_SERVICE)
    private readonly chatClient: ClientProxy,
  ) {}

  private parseTokenFromCookie(
    cookieHeader: string | undefined,
  ): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("access_token="));
    return match ? match.split("=")[1] : null;
  }

  handleConnection(client: Socket): void {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query?.token as string | undefined) ??
      this.parseTokenFromCookie(client.handshake.headers.cookie);

    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify<{ userId: number }>(token);
      (client.data as Record<string, unknown>).userId = payload.userId;
      void client.join(`user:${payload.userId}`);
      this.logger.log(`[ChatWS] Connected userId=${payload.userId}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`[ChatWS] Disconnected id=${client.id}`);
  }

  @SubscribeMessage("join")
  async handleJoin(
    client: Socket,
    payload: { conversationId: number },
  ): Promise<void> {
    const userId = (client.data as Record<string, unknown>).userId as
      | number
      | undefined;
    if (!userId) {
      client.emit("error", "Unauthorized");
      return;
    }
    try {
      const isMember = await firstValueFrom(
        this.chatClient
          .send<boolean>(CHAT_MESSAGE_PATTERN.CHAT_CHECK_MEMBERSHIP, {
            userId,
            conversationId: payload.conversationId,
          })
          .pipe(timeout(10000)),
      );
      if (!isMember) {
        client.emit("error", "Access denied");
        return;
      }
      void client.join(`conv:${payload.conversationId}`);
    } catch {
      client.emit("error", "Failed to join conversation");
    }
  }

  @SubscribeMessage("send_message")
  async handleSendMessage(
    client: Socket,
    payload: {
      conversationId: number;
      content: string;
      parentMessageId?: number;
    },
  ): Promise<void> {
    const userId = (client.data as Record<string, unknown>).userId as
      | number
      | undefined;
    if (!userId) {
      client.emit("error", "Unauthorized");
      return;
    }
    try {
      const saved = await firstValueFrom(
        this.chatClient
          .send<unknown>(CHAT_MESSAGE_PATTERN.CHAT_SEND_MESSAGE, {
            userId,
            dto: {
              conversationId: payload.conversationId,
              content: payload.content,
              parentMessageId: payload.parentMessageId,
            },
          })
          .pipe(timeout(10000)),
      );
      this.server
        .to(`conv:${payload.conversationId}`)
        .emit("new_message", saved);
    } catch (error) {
      client.emit("error", "Failed to send message");
      this.logger.error("send_message failed", error);
    }
  }
}
