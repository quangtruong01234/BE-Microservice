import { Injectable, Logger } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { JwtService } from "@nestjs/jwt";
import { Server, Socket } from "socket.io";
import { gatewayCorsOptions } from "../common/cors";

@Injectable()
@WebSocketGateway({
  cors: gatewayCorsOptions,
  namespace: "/notifications",
})
export class NotificationWsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationWsGateway.name);

  constructor(private readonly jwtService: JwtService) {}

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
      void client.join(`user:${userId}`);
      this.logger.log(
        `[NotificationWS] Connected userId=${userId} id=${client.id}`,
      );
    } catch {
      this.logger.warn(
        `[NotificationWS] Invalid token, disconnecting ${client.id}`,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`[NotificationWS] Disconnected id=${client.id}`);
  }

  sendToUser(userId: number, payload: unknown): void {
    this.server.to(`user:${userId}`).emit("notification", payload);
  }
}
