import { Body, Controller, Logger, Post, SetMetadata } from "@nestjs/common";
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from "@nestjs/microservices";
import { PaymentsService } from "./payments.service";
import { EVENT } from "@app/common/constants/event";
import { handleZaloPayCallback } from "./zalopay/zalopay.callback";

const Public = () => SetMetadata("isPublic", true);

@Controller()
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @EventPattern(EVENT.ORDER_CREATED_EVENT)
  async handleOrderCreated(
    @Payload()
    order: { id: number; total: number },
    @Ctx() context: RmqContext,
  ) {
    void context;
    this.logger.log(`[PAYMENTS] Received order_created for order: ${order.id}`);
    await this.paymentsService.processPayment(
      String(order.id),
      order.total,
      `Payment for order ${order.id}`,
    );
  }

  @MessagePattern("get_payment_url")
  getPaymentUrl(
    @Payload() data: { orderId: number },
  ): Promise<{ order_url: string | null; status: string | null }> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return this.paymentsService.getPaymentUrl(data.orderId);
  }

  @Post("zalopay/callback")
  @Public()
  zaloPayCallback(@Body() body: { data: string; mac: string }): {
    return_code: number;
    return_message: string;
  } {
    return handleZaloPayCallback(body);
  }
}
