import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { timingSafeEqual } from "crypto";
import { GHN_MESSAGE } from "libs/constant/response-message.constant";
import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { GhnWebhookDto } from "./dto/ghn-webhook.dto";
import { GhnWebhookService } from "./ghn-webhook.service";
import { GHN_WEBHOOK_KNOWN_FIELDS } from "./ghn-webhook.constants";

@Controller()
export class GhnWebhookController {
  private readonly logger = new Logger(GhnWebhookController.name);
  private readonly webhookSecret: string;

  constructor(private readonly ghnWebhookService: GhnWebhookService) {
    const webhookSecret = process.env.GHN_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error("GHN_WEBHOOK_SECRET is required");
    }
    this.webhookSecret = webhookSecret;
  }

  // Served at both the legacy `/ghn/webhook` and the prefix-consistent
  // `/api/ghn/webhook` so a GHN dashboard configured with either URL reaches us.
  // Both paths are excluded from the global `api` prefix in main.ts.
  @Post(["ghn/webhook", "api/ghn/webhook"])
  @Public()
  @HttpCode(200)
  // Explicit budget so GHN status-update bursts are never throttled by a
  // lower global default (webhook is per-IP identified).
  @RateLimit({ limit: 300, ttl: 60 })
  async handleWebhook(
    // Raw record on purpose: real GHN callbacks carry many extra fields
    // (Time, Type, CODAmount, ...) that the global forbidNonWhitelisted
    // ValidationPipe would 400. Known fields are validated manually below.
    @Body() body: Record<string, unknown>,
    @Headers("x-ghn-webhook-token") headerToken?: string,
    @Query("token") queryToken?: string,
  ): Promise<{ success: boolean }> {
    const providedToken = headerToken ?? queryToken;
    if (!this.isValidToken(providedToken)) {
      this.logger.warn("Rejected GHN webhook with invalid authentication");
      throw new UnauthorizedException(GHN_MESSAGE.INVALID_WEBHOOK_AUTH);
    }
    if (!headerToken && queryToken) {
      // Query tokens leak into access logs — header is the supported path.
      this.logger.warn(
        "GHN webhook authenticated via deprecated ?token= query parameter — configure the x-ghn-webhook-token header instead",
      );
    }

    const webhookDto = await this.validateKnownFields(body);
    const orderCode = webhookDto.OrderCode ?? webhookDto.order_code;
    const status = webhookDto.Status ?? webhookDto.status;

    if (!orderCode || !status) {
      this.logger.warn(
        `GHN webhook missing order code or status: ${JSON.stringify(body)}`,
      );
      return { success: true };
    }

    await this.ghnWebhookService.handleWebhook(orderCode, status);
    return { success: true };
  }

  private async validateKnownFields(
    body: Record<string, unknown>,
  ): Promise<GhnWebhookDto> {
    const knownFields: Record<string, unknown> = {};
    if (body && typeof body === "object") {
      for (const field of GHN_WEBHOOK_KNOWN_FIELDS) {
        if (field in body) {
          knownFields[field] = body[field];
        }
      }
    }
    const webhookDto = plainToInstance(GhnWebhookDto, knownFields);
    const validationErrors = await validate(webhookDto);
    if (validationErrors.length > 0) {
      const messages = validationErrors.flatMap((error) =>
        Object.values(error.constraints ?? {}),
      );
      this.logger.warn(
        `Rejected GHN webhook with invalid payload: ${messages.join(", ")}`,
      );
      throw new BadRequestException(messages);
    }
    return webhookDto;
  }

  private isValidToken(token: string | undefined): boolean {
    if (!token) {
      return false;
    }

    const expected = Buffer.from(this.webhookSecret);
    const provided = Buffer.from(token);
    return (
      expected.length === provided.length && timingSafeEqual(expected, provided)
    );
  }
}
