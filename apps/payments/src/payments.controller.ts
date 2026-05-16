import { Controller, Logger } from "@nestjs/common";
import { Ctx, EventPattern, Payload, RmqContext } from "@nestjs/microservices";
import { PaymentsService } from "./payments.service";
import { EVENT } from "@app/common/constants/event";

@Controller()
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @EventPattern(EVENT.ORDER_CREATED_EVENT)
  async handleOrderCreated(
    @Payload()
    data: { data: { id: number; total: number } },
    @Ctx() context: RmqContext,
  ) {
    void context;
    const order = data.data;
    this.logger.log(`[PAYMENTS] Received order_created for order: ${order.id}`);
    await this.paymentsService.processPayment(order);
  }
}
