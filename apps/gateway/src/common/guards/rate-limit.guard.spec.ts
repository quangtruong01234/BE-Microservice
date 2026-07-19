import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CachedService } from "@app/cached";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { RATE_LIMIT_OPTIONS_KEY } from "../decorators/rate-limit.decorator";
import { CustomRateLimitGuard } from "./rate-limit.guard";

interface MockRequestOptions {
  method?: string;
}

function createContext(options: MockRequestOptions = {}): ExecutionContext {
  const request = {
    method: options.method ?? "GET",
    path: "/api/products",
    route: { path: "/api/products" },
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function createGuard(overrides: {
  isPublic: boolean;
  decoratorOptions?: { limit?: number; ttl?: number };
}): { guard: CustomRateLimitGuard; increment: jest.Mock } {
  const increment = jest.fn().mockResolvedValue(1);
  const cachedService = {
    incrementWithWindow: increment,
  } as unknown as CachedService;
  const reflector = {
    get: jest.fn((key: string) =>
      key === RATE_LIMIT_OPTIONS_KEY ? overrides.decoratorOptions : undefined,
    ),
    getAllAndOverride: jest.fn((key: string) =>
      key === IS_PUBLIC_KEY ? overrides.isPublic : undefined,
    ),
  } as unknown as Reflector;
  return {
    guard: new CustomRateLimitGuard(cachedService, reflector),
    increment,
  };
}

describe("CustomRateLimitGuard RATE_LIMIT_SKIP_PUBLIC_GET", () => {
  const originalEnvValue = process.env.RATE_LIMIT_SKIP_PUBLIC_GET;

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env.RATE_LIMIT_SKIP_PUBLIC_GET;
    } else {
      process.env.RATE_LIMIT_SKIP_PUBLIC_GET = originalEnvValue;
    }
  });

  it("skips the Redis counter for a @Public GET without @RateLimit when enabled", async () => {
    process.env.RATE_LIMIT_SKIP_PUBLIC_GET = "true";
    const { guard, increment } = createGuard({ isPublic: true });

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(increment).not.toHaveBeenCalled();
  });

  it("still counts @Public GETs when the flag is off (default)", async () => {
    delete process.env.RATE_LIMIT_SKIP_PUBLIC_GET;
    const { guard, increment } = createGuard({ isPublic: true });

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(increment).toHaveBeenCalledTimes(1);
  });

  it("still counts non-public GETs when enabled", async () => {
    process.env.RATE_LIMIT_SKIP_PUBLIC_GET = "true";
    const { guard, increment } = createGuard({ isPublic: false });

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(increment).toHaveBeenCalledTimes(1);
  });

  it("still counts @Public POSTs when enabled", async () => {
    process.env.RATE_LIMIT_SKIP_PUBLIC_GET = "true";
    const { guard, increment } = createGuard({ isPublic: true });

    await expect(
      guard.canActivate(createContext({ method: "POST" })),
    ).resolves.toBe(true);
    expect(increment).toHaveBeenCalledTimes(1);
  });

  it("still counts routes with an explicit @RateLimit when enabled", async () => {
    process.env.RATE_LIMIT_SKIP_PUBLIC_GET = "true";
    const { guard, increment } = createGuard({
      isPublic: true,
      decoratorOptions: { limit: 10, ttl: 60 },
    });

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(increment).toHaveBeenCalledTimes(1);
  });
});
