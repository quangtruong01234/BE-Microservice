import { RequestHandler } from "express";
import { monitorEventLoopDelay } from "perf_hooks";
import { parseBooleanEnv, resolvePositiveIntegerEnv } from "./security";

/**
 * SCALE-05c — load-shedding guard. When the gateway event loop is saturated,
 * every queued request would eventually time out (10s TCP timeouts cascading);
 * shedding excess load early with a cheap 503 + Retry-After keeps the process
 * responsive for the requests it can still serve.
 *
 * Payment/GHN callbacks and health probes are exempt: external providers
 * retry on their own schedule and a shed callback could lose a real payment
 * confirmation, while health endpoints must answer even under load.
 */

const EXEMPT_PATHS = new Set([
  "/zalopay/callback",
  "/vnpay/callback",
  "/ghn/webhook",
  "/api/ghn/webhook",
  "/live",
  "/ready",
  "/health",
]);

export interface BackpressureOptions {
  maxEventLoopDelayMs?: number;
  sampleIntervalMs?: number;
  retryAfterSeconds?: number;
  /** Test seam: overrides the event-loop-delay reading (ms). */
  readDelayMs?: () => number;
}

export function isBackpressureEnabled(): boolean {
  return parseBooleanEnv("BACKPRESSURE_ENABLED", true);
}

export function backpressureMiddleware(
  options: BackpressureOptions = {},
): RequestHandler {
  const maxDelayMs =
    options.maxEventLoopDelayMs ??
    resolvePositiveIntegerEnv("BACKPRESSURE_MAX_EVENT_LOOP_DELAY_MS", 500);
  const sampleIntervalMs =
    options.sampleIntervalMs ??
    resolvePositiveIntegerEnv("BACKPRESSURE_SAMPLE_INTERVAL_MS", 1000);
  const retryAfterSeconds =
    options.retryAfterSeconds ??
    resolvePositiveIntegerEnv("BACKPRESSURE_RETRY_AFTER_SECONDS", 2);

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const readDelayMs =
    options.readDelayMs ??
    ((): number => {
      const meanMs = histogram.mean / 1e6;
      histogram.reset();
      return meanMs;
    });

  let lastSampleAt = 0;
  let lastDelayMs = 0;

  return (request, response, next): void => {
    const now = Date.now();
    if (now - lastSampleAt >= sampleIntervalMs) {
      lastSampleAt = now;
      lastDelayMs = readDelayMs();
    }

    if (lastDelayMs <= maxDelayMs || EXEMPT_PATHS.has(request.path)) {
      next();
      return;
    }

    response
      .status(503)
      .setHeader("Retry-After", String(retryAfterSeconds))
      .json({
        statusCode: 503,
        status: "error",
        error: "Service Unavailable",
        message: "Server is under heavy load, please retry shortly",
        data: null,
        timestamp: new Date().toISOString(),
        path: request.path,
        method: request.method,
      });
  };
}
