import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core/services/reflector.service";
import { JwtService } from "@nestjs/jwt";
import { Request, Response } from "express";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    //check if the route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      console.log("JwtAuthGuard: No token found");
      throw new UnauthorizedException("Access token is required");
    }

    try {
      // Verify JWT token
      const payload = await this.jwtService.verifyAsync(token);
      console.log("JWT Payload:", payload);

      // Attach user info to request
      const userInfo = {
        id: payload.sub || payload.id,
        username: payload.username,
        email: payload.email,
        roles: payload.roles || [],
        permissions: payload.permissions || [],
      };

      (request as any).user = userInfo;
      console.log("Attached user to request:", userInfo);
      return true;
    } catch (error) {
      throw new UnauthorizedException(error.message);
    }
  }

  private extractTokenFromHeader(request: Request): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return null;
    }

    const [type, token] = authHeader.split(" ");
    console.log("Authorization Header Type:", type, token);
    return type === "Bearer" ? token : null;
  }
}
