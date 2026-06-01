import { Injectable, Logger } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { JwtService } from "@nestjs/jwt";
import { Server, Socket } from "socket.io";
import { PORT_TCP } from "libs/constant/port-tcp.constant";
import { ChatService } from "./chat.service";

@Injectable()
@WebSocketGateway(PORT_TCP.CHAT_WS_PORT, {
  cors: {
    origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
    credentials: true,
  },
  namespace: "/chat",
})
export class ChatWsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatWsGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
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
      const userId = payload.userId;
      (client.data as Record<string, unknown>).userId = userId;
      void client.join(`user:${userId}`);
      this.logger.log(`Client connected: userId=${userId}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
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
    const isMember = await this.chatService.checkMembership(
      userId,
      payload.conversationId,
    );
    if (!isMember) {
      client.emit("error", "Access denied");
      return;
    }
    void client.join(`conv:${payload.conversationId}`);
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
      const saved = await this.chatService.sendMessage(userId, {
        conversationId: payload.conversationId,
        content: payload.content,
        parentMessageId: payload.parentMessageId,
      });
      this.server
        .to(`conv:${payload.conversationId}`)
        .emit("new_message", saved);
    } catch (error) {
      client.emit("error", "Failed to send message");
      this.logger.error("send_message failed", error);
    }
  }
}
