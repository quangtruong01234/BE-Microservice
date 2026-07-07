import { Module } from "@nestjs/common";
import { CachedModule } from "@app/cached";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  imports: [CachedModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
