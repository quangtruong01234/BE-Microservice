import { Inject, Injectable, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { catchError, firstValueFrom, timeout } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { ORDER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";

@Injectable()
export class GhnWebhookService {
  private readonly logger = new Logger(GhnWebhookService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.ORDERS_SERVICE)
    private readonly ordersClient: ClientProxy,
  ) {}

  async handleWebhook(ghnOrderCode: string, ghnStatus: string): Promise<void> {
    try {
      await firstValueFrom(
        this.ordersClient
          .send(ORDER_MESSAGE_PATTERN.GHN_WEBHOOK, { ghnOrderCode, ghnStatus })
          .pipe(
            timeout(10000),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (err) {
      this.logger.error(
        `GHN webhook TCP failed for order ${ghnOrderCode}: ${err}`,
      );
    }
  }
}
