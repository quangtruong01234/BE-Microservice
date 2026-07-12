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
