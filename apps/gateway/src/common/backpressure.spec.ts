import { Request, Response } from "express";
import { backpressureMiddleware } from "./backpressure";

interface MockResponse {
  statusCode: number | null;
  headers: Record<string, string>;
  body: unknown;
  response: Response;
}

function createMockResponse(): MockResponse {
  const mock: MockResponse = {
    statusCode: null,
    headers: {},
    body: null,
    response: null as unknown as Response,
  };
  const response = {
    status(code: number) {
      mock.statusCode = code;
      return response;
    },
    setHeader(name: string, value: string) {
      mock.headers[name] = value;
      return response;
    },
    json(payload: unknown) {
      mock.body = payload;
      return response;
    },
  } as unknown as Response;
  mock.response = response;
  return mock;
}

function createRequest(path: string, method = "GET"): Request {
  return { path, method } as Request;
}

describe("backpressureMiddleware", () => {
  it("passes requests through when event loop delay is under the threshold", () => {
    const middleware = backpressureMiddleware({
      maxEventLoopDelayMs: 500,
      sampleIntervalMs: 0,
      readDelayMs: () => 10,
    });
    const mock = createMockResponse();
    const next = jest.fn();

    middleware(createRequest("/api/products"), mock.response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mock.statusCode).toBeNull();
  });

  it("sheds with 503 + Retry-After when the event loop is saturated", () => {
    const middleware = backpressureMiddleware({
      maxEventLoopDelayMs: 500,
      sampleIntervalMs: 0,
      retryAfterSeconds: 2,
      readDelayMs: () => 900,
    });
    const mock = createMockResponse();
    const next = jest.fn();

    middleware(createRequest("/api/products"), mock.response, next);

    expect(next).not.toHaveBeenCalled();
    expect(mock.statusCode).toBe(503);
    expect(mock.headers["Retry-After"]).toBe("2");
    expect(mock.body).toMatchObject({
      statusCode: 503,
      status: "error",
      message: expect.stringContaining("heavy load") as string,
    });
  });

  it("never sheds payment callbacks, webhooks, or health probes", () => {
    const middleware = backpressureMiddleware({
      maxEventLoopDelayMs: 500,
      sampleIntervalMs: 0,
      readDelayMs: () => 5000,
    });
    for (const path of [
      "/zalopay/callback",
      "/vnpay/callback",
      "/ghn/webhook",
      "/api/ghn/webhook",
      "/live",
      "/ready",
      "/health",
    ]) {
      const mock = createMockResponse();
      const next = jest.fn();
      middleware(createRequest(path, "POST"), mock.response, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(mock.statusCode).toBeNull();
    }
  });

  it("only re-samples the delay after the sample interval elapses", () => {
    const readings = [900, 10];
    let reads = 0;
    const middleware = backpressureMiddleware({
      maxEventLoopDelayMs: 500,
      sampleIntervalMs: 60_000,
      readDelayMs: () => {
        reads++;
        return readings.shift() ?? 10;
      },
    });

    const first = createMockResponse();
    middleware(createRequest("/api/products"), first.response, jest.fn());
    expect(first.statusCode).toBe(503);

    // Second request inside the same window reuses the cached saturated reading.
    const second = createMockResponse();
    middleware(createRequest("/api/products"), second.response, jest.fn());
    expect(second.statusCode).toBe(503);
    expect(reads).toBe(1);
  });
});
