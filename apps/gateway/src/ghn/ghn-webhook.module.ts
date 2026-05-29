import { forwardRef, Module } from "@nestjs/common";
import { GhnWebhookController } from "./ghn-webhook.controller";
import { GhnWebhookService } from "./ghn-webhook.service";
import { GatewayModule } from "../gateway.module";

@Module({
  imports: [forwardRef(() => GatewayModule)],
  controllers: [GhnWebhookController],
  providers: [GhnWebhookService],
})
export class GhnWebhookModule {}
