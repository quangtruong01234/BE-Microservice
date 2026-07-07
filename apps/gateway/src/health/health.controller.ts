import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { HealthService } from "./health.service";

@ApiTags("Health")
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("live")
  @Public()
  @ApiOperation({ summary: "Gateway liveness probe" })
  @ApiResponse({ status: HttpStatus.OK, description: "Gateway is alive." })
  live(@Res() response: Response): Response {
    return response.status(HttpStatus.OK).json(this.healthService.getLive());
  }

  @Get("ready")
  @Public()
  @ApiOperation({ summary: "Gateway readiness probe" })
  @ApiResponse({ status: HttpStatus.OK, description: "Gateway is ready." })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: "A required checked dependency is unavailable.",
  })
  async ready(@Res() response: Response): Promise<Response> {
    const health = await this.healthService.getReady();
    const statusCode =
      health.status === "error"
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.OK;

    return response.status(statusCode).json(health);
  }

  @Get("health")
  @Public()
  @ApiOperation({ summary: "Gateway health summary" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Gateway is usable or degraded.",
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: "Gateway is not usable.",
  })
  async health(@Res() response: Response): Promise<Response> {
    const health = await this.healthService.getHealth();
    const statusCode =
      health.status === "error"
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.OK;

    return response.status(statusCode).json(health);
  }
}
