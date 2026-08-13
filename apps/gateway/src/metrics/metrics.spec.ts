import { NextFunction, Request, Response } from "express";
import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { MetricsController } from "./metrics.controller";
import { MetricsMiddleware } from "./metrics.middleware";
import { MetricsService } from "./metrics.service";

type ResponseListener = () => void;

interface MockResponse {
  emit: (event: "finish" | "close") => void;
  response: Response;
}

function createMockResponse(statusCode = 200): MockResponse {
  const listenersByEvent: Record<string, ResponseListener[]> = {};
  const response = {
    statusCode,
    on(event: string, listener: ResponseListener) {
      listenersByEvent[event] = [...(listenersByEvent[event] ?? []), listener];
      return response;
    },
  } as unknown as Response;

  return {
    response,
    emit: (event) =>
      (listenersByEvent[event] ?? []).forEach((listener) => listener()),
  };
}

function createRequest(
  overrides: Partial<Request> & { route?: { path: string } } = {},
): Request {
  return {
    method: "GET",
    baseUrl: "",
    ...overrides,
  } as Request;
}

describe("MetricsService", () => {
  it("renders the recorded request as Prometheus text", async () => {
    const service = new MetricsService();

    service.startRequest();
    service.finishRequest("GET", "/api/products/:id", 200, 0.12);

    const rendered = await service.render();
    expect(rendered).toContain(
      'http_requests_total{method="GET",route="/api/products/:id",status_code="200"} 1',
    );
    expect(rendered).toContain("http_request_duration_seconds_bucket");
    // Default process metrics prove collectDefaultMetrics is wired up.
    expect(rendered).toContain("process_cpu_user_seconds_total");
  });

  it("returns the in-flight gauge to zero once the request finishes", async () => {
    const service = new MetricsService();

    service.startRequest();
    service.finishRequest("GET", "/live", 200, 0.01);

    expect(await service.render()).toContain("http_requests_in_flight 0");
  });
});

describe("MetricsMiddleware", () => {
  it("labels the request with the matched route pattern, not the raw URL", () => {
    const service = new MetricsService();
    const finishRequest = jest.spyOn(service, "finishRequest");
    const middleware = new MetricsMiddleware(service);
    const { response, emit } = createMockResponse(201);
    const next = jest.fn() as unknown as NextFunction;

    middleware.use(
      createRequest({
        method: "POST",
        baseUrl: "",
        route: { path: "/api/order/:id" },
      }),
      response,
      next,
    );
    emit("finish");

    expect(next).toHaveBeenCalled();
    expect(finishRequest).toHaveBeenCalledWith(
      "POST",
      "/api/order/:id",
      201,
      expect.any(Number),
    );
  });

  it("collapses an unmatched path into a single series", () => {
    const service = new MetricsService();
    const finishRequest = jest.spyOn(service, "finishRequest");
    const middleware = new MetricsMiddleware(service);
    const { response, emit } = createMockResponse(404);

    middleware.use(createRequest(), response, jest.fn());
    emit("finish");

    expect(finishRequest).toHaveBeenCalledWith(
      "GET",
      "unmatched",
      404,
      expect.any(Number),
    );
  });

  it("records a request exactly once when both finish and close fire", () => {
    const service = new MetricsService();
    const finishRequest = jest.spyOn(service, "finishRequest");
    const middleware = new MetricsMiddleware(service);
    const { response, emit } = createMockResponse();

    middleware.use(createRequest(), response, jest.fn());
    emit("finish");
    emit("close");

    expect(finishRequest).toHaveBeenCalledTimes(1);
  });
});

describe("MetricsController scrape guard", () => {
  const originalToken = process.env.METRICS_TOKEN;
  const originalNodeEnv = process.env.NODE_ENV;

  const createController = (): MetricsController =>
    new MetricsController(new MetricsService());

  const createResponse = (): {
    response: Response;
    sent: { status: number | null; contentType: string | null; body: unknown };
  } => {
    const sent = {
      status: null as number | null,
      contentType: null as string | null,
      body: null as unknown,
    };
    const response = {
      status(code: number) {
        sent.status = code;
        return response;
      },
      setHeader(name: string, value: string) {
        if (name === "Content-Type") {
          sent.contentType = value;
        }
        return response;
      },
      send(payload: unknown) {
        sent.body = payload;
        return response;
      },
    } as unknown as Response;

    return { response, sent };
  };

  afterEach(() => {
    process.env.METRICS_TOKEN = originalToken;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("serves the scrape without a token outside production", async () => {
    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = "development";
    const { response, sent } = createResponse();

    await createController().metrics(undefined, response);

    expect(sent.status).toBe(200);
    expect(sent.contentType).toContain("text/plain");
    expect(String(sent.body)).toContain("http_requests_in_flight");
  });

  it("hides the endpoint in production when no token is configured", async () => {
    delete process.env.METRICS_TOKEN;
    process.env.NODE_ENV = "production";
    const { response } = createResponse();

    await expect(
      createController().metrics(undefined, response),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects a wrong or missing bearer token when one is configured", async () => {
    process.env.METRICS_TOKEN = "scrape-secret";
    const controller = createController();

    await expect(
      controller.metrics(undefined, createResponse().response),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.metrics("Bearer wrong-secret", createResponse().response),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // A prefix of the real token must not pass either.
    await expect(
      controller.metrics("Bearer scrape", createResponse().response),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("accepts the configured bearer token", async () => {
    process.env.METRICS_TOKEN = "scrape-secret";
    const { response, sent } = createResponse();

    await createController().metrics("Bearer scrape-secret", response);

    expect(sent.status).toBe(200);
  });
});
