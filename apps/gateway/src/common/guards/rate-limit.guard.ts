import { CachedService } from "@app/cached";
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { RATE_LIMIT_OPTIONS_KEY } from "../decorators/rate-limit.decorator";
import { Request } from "express";

@Injectable()
export class CustomRateLimitGuard implements CanActivate {
  private readonly defaultLimit: number = 20;
  private readonly defaultTtl: number = 60;
  constructor(
    private cachedService: CachedService,
    private reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      // Get custom limit từ decorator nếu có
      const decoratorOptions = this.reflector.get<{
        limit?: number;
        ttl?: number;
      }>(RATE_LIMIT_OPTIONS_KEY, context.getHandler());

      const limit = decoratorOptions?.limit || this.defaultLimit;
      const ttl = decoratorOptions?.ttl || this.defaultTtl;

      const request = context.switchToHttp().getRequest<Request>();
      const identifier = this.getIdentifier(request);
      const key = `throttle:${identifier}`;

      const current = await this.cachedService.incr(key); //atomic increment

      if (current === 1) {
        // Set TTL lần đầu tiên
        await this.cachedService.expire(key, ttl); //60s
      }

      if (current > limit) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Too many requests. Max ${limit} requests per ${ttl} seconds`,
            retryAfter: ttl,
          },
          HttpStatus.TOO_MANY_REQUESTS,
          { cause: { retryAfter: ttl } },
        );
      }

      // Thêm info vào request object để dùng sau
      (request as any).rateLimit = {
        limit,
        current,
        remaining: limit - current,
        resetTime: Date.now() + ttl * 1000,
      };
      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      // Nếu Redis có lỗi, cho phép request đi qua
      console.warn("Rate limit check failed:", error);
      return true;
    }
  }

  /**
   * Lấy identifier để rate limit
   * Ưu tiên: userId (nếu đã auth) > IP address
   */
  private getIdentifier(request: Request): string {
    // Nếu user đã authenticate, giới hạn per user
    if ((request as any).user?.id) {
      return `user:${(request as any).user.id}`;
    }

    // Nếu không, giới hạn per IP
    const ip =
      request.ip ||
      (request.headers["x-forwarded-for"] as string)?.split(",")[0] ||
      request.socket.remoteAddress ||
      "unknown";

    return `ip:${ip}`;
  }
}
