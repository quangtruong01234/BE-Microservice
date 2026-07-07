import { CachedService } from "@app/cached";
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RATE_LIMIT_OPTIONS_KEY } from "../decorators/rate-limit.decorator";
import { Request } from "express";
import { isProduction, resolvePositiveIntegerEnv } from "../security";

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
  private readonly logger = new Logger(CustomRateLimitGuard.name);
  private readonly defaultLimit: number = resolvePositiveIntegerEnv(
    "RATE_LIMIT_DEFAULT_LIMIT",
    120,
  );
  private readonly defaultTtl: number = resolvePositiveIntegerEnv(
    "RATE_LIMIT_DEFAULT_TTL_SECONDS",
    60,
  );
  private readonly redisTimeoutMs: number = resolvePositiveIntegerEnv(
    "RATE_LIMIT_REDIS_TIMEOUT_MS",
    500,
  );

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
      const routePath =
        (request.route as { path?: string } | undefined)?.path ?? request.path;
      const route = `${request.method}:${routePath}`;
      const key = `throttle:${route}:${identifier}`;

      const current = await this.withRedisTimeout(this.cachedService.incr(key));

      if (current === 1) {
        await this.withRedisTimeout(this.cachedService.expire(key, ttl));
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

      const message = error instanceof Error ? error.message : "Unknown error";
      if (isProduction()) {
        this.logger.error(
          `Rate limit check failed in production; failing closed: ${message}`,
        );
        throw new ServiceUnavailableException(
          "Rate limit protection is temporarily unavailable",
        );
      }

      this.logger.warn(
        `Rate limit check failed in non-production; allowing request: ${message}`,
      );
      return true;
    }
  }

  private async withRedisTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error("Redis rate limit operation timed out"));
      }, this.redisTimeoutMs);
    });

    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
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
