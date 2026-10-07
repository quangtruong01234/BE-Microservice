import { Request } from "express";

export interface RateLimitInfo {
  limit: number;
  current: number;
  remaining: number;
  resetTime: number;
}

export interface RequestWithRateLimit extends Request {
  rateLimit?: RateLimitInfo;
}

// Lives here, not in the decorator, so the decorator can import the guard
// without an import cycle.
export const RATE_LIMIT_OPTIONS_KEY = "rate-limit-options";

export interface RateLimitOptions {
  limit?: number;
  ttl?: number;
  /**
   * "ip" (default) is counted by the global guard, which runs before
   * JwtAuthGuard and so keys by IP. "user" is counted by a second,
   * route-level run after JwtAuthGuard, keyed by the caller's id.
   */
  per?: "ip" | "user";
}
