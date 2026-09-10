import { Inject, Injectable, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { catchError, firstValueFrom, timeout } from "rxjs";
import { NAME_SERVICE_TCP } from "libs/constant/port-tcp.constant";
import { ORDER_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";
import { TCP_TIMEOUT_MS } from "libs/constant/tcp-timeout.constant";

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
            timeout(TCP_TIMEOUT_MS.WRITE),
            catchError((err: unknown) => {
              throw err;
            }),
          ),
      );
    } catch (err) {
      this.logger.error(
        `GHN webhook TCP failed for order ${ghnOrderCode}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
