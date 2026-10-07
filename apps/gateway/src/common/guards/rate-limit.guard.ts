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
import { COMMON_MESSAGE } from "libs/constant/response-message.constant";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { isProduction, resolvePositiveIntegerEnv } from "../security";
import {
  RATE_LIMIT_OPTIONS_KEY,
  RateLimitOptions,
  RequestWithRateLimit,
} from "./rate-limit.types";

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
  // Set RATE_LIMIT_SKIP_PUBLIC_GET=true ONLY when nginx limit_req fronts the
  // gateway — it skips the Redis counter for @Public GET/HEAD routes that have
  // no explicit @RateLimit, so cached catalog reads cost zero Redis roundtrips.
  private readonly isPublicGetSkipEnabled: boolean =
    process.env.RATE_LIMIT_SKIP_PUBLIC_GET === "true";

  constructor(
    private cachedService: CachedService,
    private reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const decoratorOptions = this.reflector.get<RateLimitOptions | undefined>(
        RATE_LIMIT_OPTIONS_KEY,
        context.getHandler(),
      );

      const limit = decoratorOptions?.limit ?? this.defaultLimit;
      const ttl = decoratorOptions?.ttl ?? this.defaultTtl;

      const request = context.switchToHttp().getRequest<RequestWithRateLimit>();

      // A request is counted once: the route-level run of a per:"user" route
      // must not re-count what an earlier pass already counted.
      if (request.rateLimit) {
        return true;
      }
      // per:"user" is counted by the route-level run, after JwtAuthGuard. The
      // global pass (no request.user yet) leaves it alone.
      if (decoratorOptions?.per === "user" && !request.user?.id) {
        return true;
      }

      if (
        this.isPublicGetSkipEnabled &&
        !decoratorOptions &&
        (request.method === "GET" || request.method === "HEAD") &&
        this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
          context.getHandler(),
          context.getClass(),
        ])
      ) {
        return true;
      }

      const identifier = this.getIdentifier(request);
      const routePath =
        (request.route as { path?: string } | undefined)?.path ?? request.path;
      const route = `${request.method}:${routePath}`;
      const key = `throttle:${route}:${identifier}`;

      const current = await this.withRedisTimeout(
        this.cachedService.incrementWithWindow(key, ttl),
      );

      if (current > limit) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: COMMON_MESSAGE.RATE_LIMIT_EXCEEDED(limit, ttl),
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
          COMMON_MESSAGE.RATE_LIMIT_UNAVAILABLE,
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
