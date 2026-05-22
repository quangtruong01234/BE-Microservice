declare namespace Express {
  interface Request {
    user?: {
      id: number;
      email: string;
      role: string;
      grants: unknown[];
    };
    rateLimit?: {
      limit: number;
      current: number;
      remaining: number;
      resetTime: number;
    };
    cookies: Record<string, string>;
  }
}
