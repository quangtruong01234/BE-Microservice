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
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { JwtPayload } from "./auth-guard.types";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
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
    const token = this.extractToken(request);

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

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      request.user = {
        id: payload.userId ?? 0,
        email: payload.email ?? "",
        role: payload.role ?? "user",
        grants: payload.grants ?? [],
      };
      return true;
    } catch {
      throw new UnauthorizedException({
        message: AUTH_MESSAGE.UNAUTHORIZED,
        errorCode: ERROR_CODE.UNAUTHENTICATED,
      });
    }
  }

  private extractToken(request: Request): string | null {
    const cookieToken = (
      request.cookies as unknown as Record<string, string | undefined>
    )["access_token"];
    if (cookieToken) return cookieToken;

    const authHeader = request.headers.authorization;
    if (!authHeader) return null;
    const [type, token] = authHeader.split(" ");
    return type === "Bearer" ? (token ?? null) : null;
  }
}
