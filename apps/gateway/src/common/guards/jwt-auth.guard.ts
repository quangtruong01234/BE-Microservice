import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { ERROR_CODE } from "libs/constant/error-code.constant";
import { AUTH_MESSAGE } from "libs/constant/response-message.constant";
import { extractAccessToken } from "../auth-cookie";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { SessionRevocationService } from "../session/session-revocation.service";
import { JwtPayload } from "./auth-guard.types";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
    private sessionRevocation: SessionRevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType<string>() !== "http") {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractAccessToken(request);

    // Both branches carry the same code on purpose: "no usable session" is one
    // thing to the client, and in production the two messages are flattened to
    // an identical "Unauthorized" anyway. It lets a caller recognise a dead
    // session positively instead of inferring it from the absence of another
    // endpoint's code (CHG-PW-02).
    if (!token) {
      throw new UnauthorizedException({
        message: AUTH_MESSAGE.ACCESS_TOKEN_REQUIRED,
        errorCode: ERROR_CODE.UNAUTHENTICATED,
      });
    }

    let payload: JwtPayload | null;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      payload = null;
    }

    // A revoked session (SESSION-REVOKE-01) is the same dead session to the
    // client as a bad signature, so it gets the identical 401.
    if (
      !payload ||
      (await this.sessionRevocation.isRevoked(payload.userId, payload.iat))
    ) {
      throw new UnauthorizedException({
        message: AUTH_MESSAGE.UNAUTHORIZED,
        errorCode: ERROR_CODE.UNAUTHENTICATED,
      });
    }

    request.user = {
      id: payload.userId ?? 0,
      email: payload.email ?? "",
      role: payload.role ?? "user",
      grants: payload.grants ?? [],
    };
    return true;
  }
}
