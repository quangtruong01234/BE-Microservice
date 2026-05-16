import { CachedService } from "@app/cached";
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RATE_LIMIT_OPTIONS_KEY } from "../decorators/rate-limit.decorator";
import { Request } from "express";

interface RateLimitInfo {
  limit: number;
  current: number;
  remaining: number;
  resetTime: number;
}

interface RequestWithRateLimit extends Request {
  rateLimit?: RateLimitInfo;
}

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
      const decoratorOptions = this.reflector.get<{
        limit?: number;
        ttl?: number;
      }>(RATE_LIMIT_OPTIONS_KEY, context.getHandler());

      const limit = decoratorOptions?.limit ?? this.defaultLimit;
      const ttl = decoratorOptions?.ttl ?? this.defaultTtl;

      const request = context.switchToHttp().getRequest<RequestWithRateLimit>();
      const identifier = this.getIdentifier(request);
      const key = `throttle:${identifier}`;

      const current = await this.cachedService.incr(key);

      if (current === 1) {
        await this.cachedService.expire(key, ttl);
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

      request.rateLimit = {
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

      console.warn("Rate limit check failed:", error);
      return true;
    }
  }

  private getIdentifier(request: RequestWithRateLimit): string {
    if (request.user?.id) {
      return `user:${String(request.user.id)}`;
    }

    const ip =
      request.ip ||
      (request.headers["x-forwarded-for"] as string)?.split(",")[0] ||
      request.socket.remoteAddress ||
      "unknown";

    return `ip:${ip}`;
  }
}
