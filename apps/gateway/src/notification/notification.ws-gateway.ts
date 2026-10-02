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
import { SessionRevocationService } from "../common/session/session-revocation.service";

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

  constructor(
    private readonly jwtService: JwtService,
    private readonly sessionRevocation: SessionRevocationService,
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
      const payload = this.jwtService.verify<{
        userId: number;
        iat?: number;
      }>(token);
      const userId = payload.userId;
      void client.join(`user:${userId}`);
      this.logger.log(
        `[NotificationWS] Connected userId=${userId} id=${client.id}`,
      );
      void this.disconnectIfRevoked(client, payload);
    } catch {
      this.logger.warn(
        `[NotificationWS] Invalid token, disconnecting ${client.id}`,
      );
      client.disconnect();
    }
  }

  /**
   * SESSION-REVOKE-01: the revocation lookup is async, so it runs AFTER the
   * synchronous join — awaiting it first would let a client's first event race
   * ahead of `client.data.userId`. A revoked socket lives for at most one
   * Redis round-trip. An already-open socket is not closed by a later
   * revocation; it dies on its next reconnect.
   */
  private async disconnectIfRevoked(
    client: Socket,
    payload: { userId: number; iat?: number },
  ): Promise<void> {
    if (await this.sessionRevocation.isRevoked(payload.userId, payload.iat)) {
      this.logger.warn(
        `[NotificationWS] Revoked session, disconnecting userId=${payload.userId}`,
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
