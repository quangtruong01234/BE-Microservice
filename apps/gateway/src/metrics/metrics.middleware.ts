import { Injectable, NestMiddleware } from "@nestjs/common";
import { NextFunction, Request, Response } from "express";
import { MetricsService } from "./metrics.service";

/**
 * Resolve the label for a finished request.
 *
 * Express fills `req.route` once a handler matches, and this runs on `finish`,
 * so the pattern (`/api/products/:id`) is available by then. Anything that
 * never matched a route — 404s, scanner traffic — collapses into a single
 * `unmatched` series instead of minting one per probed URL.
 */
function resolveRouteLabel(request: Request): string {
  // Express types `route` as `any`; narrow it to the one field that matters.
  const route = request.route as { path?: string } | undefined;
  const routePath = route?.path;
  if (!routePath) {
    return "unmatched";
  }

  const base = request.baseUrl ?? "";
  const full = `${base}${routePath}`;
  return full.length > 0 ? full : "/";
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    this.metricsService.startRequest();

    // `finish` fires once the response is flushed; `close` covers a client that
    // hung up first. Whichever comes first must decrement the in-flight gauge
    // exactly once, or the gauge drifts upwards forever.
    let isRecorded = false;
    const record = (): void => {
      if (isRecorded) {
        return;
      }
      isRecorded = true;
      const durationSeconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      this.metricsService.finishRequest(
        request.method,
        resolveRouteLabel(request),
        response.statusCode,
        durationSeconds,
      );
    };

    response.on("finish", record);
    response.on("close", record);

    next();
  }
}
