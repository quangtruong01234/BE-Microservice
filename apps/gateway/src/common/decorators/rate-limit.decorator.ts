import { SetMetadata, CustomDecorator } from "@nestjs/common";

export const RATE_LIMIT_OPTIONS_KEY = "rate-limit-options";

export const RateLimit = (options?: {
  limit?: number;
  ttl?: number;
}): CustomDecorator<string> => {
  return SetMetadata(RATE_LIMIT_OPTIONS_KEY, options || {});
};
