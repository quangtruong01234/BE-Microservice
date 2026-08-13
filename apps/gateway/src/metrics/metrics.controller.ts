import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Logger,
  NotFoundException,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { timingSafeEqual } from "crypto";
import { Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { isProduction } from "../common/security";
import { MetricsService } from "./metrics.service";

const BEARER_PREFIX = "Bearer ";

function isTokenMatching(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * RESIL-03. Prometheus scrape endpoint.
 *
 * Excluded from Swagger and from the `api` global prefix: it is an ops
 * surface, not part of the public API contract.
 */
@ApiExcludeController()
@Controller()
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private readonly metricsService: MetricsService) {}

  @Get("metrics")
  @Public()
  async metrics(
    @Headers("authorization") authorization: string | undefined,
    @Res() response: Response,
  ): Promise<Response> {
    this.assertScrapeAllowed(authorization);

    return response
      .status(HttpStatus.OK)
      .setHeader("Content-Type", this.metricsService.getContentType())
      .send(await this.metricsService.render());
  }

  /**
   * Metrics describe the shape of production traffic, so this is never open on
   * the internet by accident. With `METRICS_TOKEN` set the scraper must present
   * it; without one the endpoint is open in dev and simply does not exist in
   * production — fail closed, same posture as the rate-limit guard.
   */
  private assertScrapeAllowed(authorization: string | undefined): void {
    const expectedToken = process.env.METRICS_TOKEN?.trim();

    if (!expectedToken) {
      if (isProduction()) {
        this.logger.warn(
          "METRICS_TOKEN is not set — /metrics is disabled in production.",
        );
        throw new NotFoundException("Cannot GET /metrics");
      }
      return;
    }

    const providedToken = authorization?.startsWith(BEARER_PREFIX)
      ? authorization.slice(BEARER_PREFIX.length).trim()
      : "";

    if (!providedToken || !isTokenMatching(providedToken, expectedToken)) {
      throw new UnauthorizedException("Invalid metrics token");
    }
  }
}
