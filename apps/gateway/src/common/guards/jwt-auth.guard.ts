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

interface RoleGrant {
  resourceId: number;
  actions: string[];
  attributes: string;
  conditions: string;
}

interface JwtPayload {
  userId?: number;
  email?: string;
  role?: string;
  grants?: RoleGrant[];
}

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

    if (!token) {
      throw new UnauthorizedException("Access token is required");
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
      throw new UnauthorizedException("Unauthorized");
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
