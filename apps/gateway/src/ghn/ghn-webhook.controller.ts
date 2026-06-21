import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "crypto";
import { Public } from "../common/decorators/public.decorator";
import { GhnWebhookService } from "./ghn-webhook.service";

interface GhnWebhookBody {
  // Real GHN callbacks send PascalCase fields
  OrderCode?: string;
  Status?: string;
  // Manual tests / internal tools send snake_case
  order_code?: string;
  status?: string;
}

@Controller("ghn")
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

  @Post("webhook")
  @Public()
  @HttpCode(200)
  async handleWebhook(
    @Body() body: GhnWebhookBody,
    @Headers("x-ghn-webhook-token") headerToken?: string,
    @Query("token") queryToken?: string,
  ): Promise<{ success: boolean }> {
    const providedToken = headerToken ?? queryToken;
    if (!this.isValidToken(providedToken)) {
      this.logger.warn("Rejected GHN webhook with invalid authentication");
      throw new UnauthorizedException("Invalid webhook authentication");
    }

    const orderCode = body.OrderCode ?? body.order_code;
    const status = body.Status ?? body.status;

    if (!orderCode || !status) {
      this.logger.warn(
        `GHN webhook missing order code or status: ${JSON.stringify(body)}`,
      );
      return { success: true };
    }

    await this.ghnWebhookService.handleWebhook(orderCode, status);
    return { success: true };
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
