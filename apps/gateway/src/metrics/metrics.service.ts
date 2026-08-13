import { Injectable } from "@nestjs/common";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

/**
 * Buckets in seconds. Tuned for this gateway: most reads answer in tens of
 * milliseconds, while anything crossing a TCP hop to an external API (GHN,
 * payments) lives in the 1–10s range where the TCP timeouts sit.
 */
const REQUEST_DURATION_BUCKETS = [
  0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/**
 * RESIL-03. Owns the Prometheus registry for the gateway process.
 *
 * A dedicated `Registry` (rather than the library's global one) keeps the
 * metrics scoped to this instance and makes the service trivially testable —
 * two instances never fight over the same metric names.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly requestsTotal: Counter<"method" | "route" | "status_code"> =
    new Counter({
      name: "http_requests_total",
      help: "Total HTTP requests handled by the gateway.",
      labelNames: ["method", "route", "status_code"],
      registers: [this.registry],
    });

  private readonly requestDuration: Histogram<
    "method" | "route" | "status_code"
  > = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds, by route.",
    labelNames: ["method", "route", "status_code"],
    buckets: REQUEST_DURATION_BUCKETS,
    registers: [this.registry],
  });

  private readonly requestsInFlight: Gauge<string> = new Gauge({
    name: "http_requests_in_flight",
    help: "HTTP requests currently being processed by the gateway.",
    registers: [this.registry],
  });

  constructor() {
    // Process-level series: heap, event-loop lag, handles, CPU. On a free-tier
    // box these are the first thing to look at when the API goes slow.
    collectDefaultMetrics({ register: this.registry });
  }

  startRequest(): void {
    this.requestsInFlight.inc();
  }

  /**
   * @param route the matched ROUTE PATTERN (`/api/products/:id`), never the raw
   * URL — a raw path would mint one time series per product id and blow up the
   * registry.
   */
  finishRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    this.requestsInFlight.dec();
    const labels = {
      method,
      route,
      status_code: String(statusCode),
    };
    this.requestsTotal.inc(labels);
    this.requestDuration.observe(labels, durationSeconds);
  }

  getContentType(): string {
    return this.registry.contentType;
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
