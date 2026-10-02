import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { extractAccessToken } from "../auth-cookie";
import { SessionRevocationService } from "../session/session-revocation.service";
import { JwtPayload } from "./auth-guard.types";

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private sessionRevocation: SessionRevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractAccessToken(request);
    if (!token) return true;

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      // A revoked session (SESSION-REVOKE-01) reads as anonymous, like an
      // expired one.
      if (await this.sessionRevocation.isRevoked(payload.userId, payload.iat)) {
        return true;
      }
      request.user = {
        id: payload.userId ?? 0,
        email: payload.email ?? "",
        role: payload.role ?? "user",
        grants: payload.grants ?? [],
      };
    } catch {
      // Invalid/expired token — treat as unauthenticated, not an error
    }
    return true;
  }
}
