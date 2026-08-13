import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { MetricsController } from "./metrics.controller";
import { MetricsMiddleware } from "./metrics.middleware";
import { MetricsService } from "./metrics.service";

@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route is measured except the scrape itself — counting the scraper
    // would add a series that grows with the scrape interval and would pin the
    // in-flight gauge at >=1 in every scrape (the scrape is still open while it
    // renders). The method MUST be spelled out: `exclude("metrics")` defaults to
    // RequestMethod.ALL, which does not match the `{ path: "metrics", method:
    // GET }` entry in setGlobalPrefix's exclude list, so Nest prefixes it into
    // `/api/metrics` and the real `/metrics` stays instrumented.
    consumer
      .apply(MetricsMiddleware)
      .exclude({ path: "metrics", method: RequestMethod.GET })
      .forRoutes("*path");
  }
}
