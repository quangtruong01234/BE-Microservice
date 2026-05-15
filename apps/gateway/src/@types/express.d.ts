declare namespace Express {
  interface Request {
    user?: {
      id: number;
      username: string;
      email: string;
      roles: string[];
      permissions: string[];
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
