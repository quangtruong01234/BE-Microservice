import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";

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
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) return true;

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
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
