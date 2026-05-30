import { Injectable, Logger } from "@nestjs/common";
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { JwtService } from "@nestjs/jwt";
import { Server, Socket } from "socket.io";

@Injectable()
@WebSocketGateway(3010, { cors: { origin: "*" } })
export class NotificationWsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationWsGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  handleConnection(client: Socket): void {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query?.token as string | undefined);

    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify<{ sub: number }>(token);
      const userId = payload.sub;
      void client.join(`user:${userId}`);
      this.logger.log(`[WS] Client connected userId=${userId} id=${client.id}`);
    } catch {
      this.logger.warn(`[WS] Invalid token, disconnecting ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`[WS] Client disconnected id=${client.id}`);
  }

  sendToUser(userId: number, payload: unknown): void {
    this.server.to(`user:${userId}`).emit("notification", payload);
  }
}
