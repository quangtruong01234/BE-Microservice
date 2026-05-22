import { Body, Controller, Logger, Post, SetMetadata } from "@nestjs/common";
import { Ctx, EventPattern, MessagePattern, Payload, RmqContext } from "@nestjs/microservices";
import { PaymentsService } from "./payments.service";
import { EVENT } from "@app/common/constants/event";
import { handleZaloPayCallback } from "./zalopay/zalopay.callback";
import { PAYMENT_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";

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

  @MessagePattern(PAYMENT_MESSAGE_PATTERN.GET_PAYMENT_URL)
  async getPaymentUrl(
    @Payload() data: { orderId: number },
  ): Promise<{ order_url: string | null; status: string | null }> {
    return this.paymentsService.getPaymentUrl(data.orderId);
  }

  @Post("zalopay/callback")
  @Public()
  async zaloPayCallback(
    @Body() body: { data: string; mac: string },
  ): Promise<{ return_code: number; return_message: string }> {
    return handleZaloPayCallback(body);
  }
}
