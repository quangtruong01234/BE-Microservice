import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { GhnWebhookService } from "./ghn-webhook.service";

@Controller("ghn")
export class GhnWebhookController {
  constructor(private readonly ghnWebhookService: GhnWebhookService) {}

  @Post("webhook")
  @Public()
  @HttpCode(200)
  async handleWebhook(
    @Body() body: { order_code: string; status: string },
  ): Promise<{ success: boolean }> {
    await this.ghnWebhookService.handleWebhook(body.order_code, body.status);
    return { success: true };
  }
}
