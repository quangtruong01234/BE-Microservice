import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import { CustomRateLimitGuard } from "../guards/rate-limit.guard";
import {
  RATE_LIMIT_OPTIONS_KEY,
  RateLimitOptions,
} from "../guards/rate-limit.types";

export { RATE_LIMIT_OPTIONS_KEY };
export type { RateLimitOptions };

export const RateLimit = (
  options?: RateLimitOptions,
): MethodDecorator & ClassDecorator => {
  const metadata = SetMetadata(RATE_LIMIT_OPTIONS_KEY, options || {});
  // per:"user" re-runs the guard at route level, after JwtAuthGuard has set
  // request.user; the global pass skips it (see CustomRateLimitGuard).
  return options?.per === "user"
    ? applyDecorators(metadata, UseGuards(CustomRateLimitGuard))
    : metadata;
};
