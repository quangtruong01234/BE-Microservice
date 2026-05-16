import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

interface JwtPayload {
  sub?: number;
  id?: number;
  username?: string;
  email?: string;
  roles?: string[];
  permissions?: string[];
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException("Access token is required");
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      request.user = {
        id: payload.sub ?? payload.id ?? 0,
        username: payload.username ?? "",
        email: payload.email ?? "",
        roles: payload.roles ?? [],
        permissions: payload.permissions ?? [],
      };
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid token";
      throw new UnauthorizedException(message);
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
