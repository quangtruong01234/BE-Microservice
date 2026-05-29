import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  SetMetadata,
} from "@nestjs/common";
import {
  Ctx,
  EventPattern,
  MessagePattern,
  Payload,
  RmqContext,
} from "@nestjs/microservices";
import { PaymentsService } from "./payments.service";
import { VNPayStrategy } from "./vnpay/vnpay.service";
import { EVENT } from "@app/common/constants/event";
import { handleZaloPayCallback } from "./zalopay/zalopay.callback";
import { handleVNPayCallback } from "./vnpay/vnpay.callback";
import { PAYMENT_MESSAGE_PATTERN } from "libs/constant/message-pattern.constant";

const Public = () => SetMetadata("isPublic", true);

@Controller()
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly vnpayStrategy: VNPayStrategy,
  ) {}

  @EventPattern(EVENT.ORDER_CREATED_EVENT)
  async handleOrderCreated(
    @Payload()
    order: { id: number; total: number; payment_method?: string },
    @Ctx() context: RmqContext,
  ) {
    void context;
    if (order.payment_method === "cod") return;
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
    return this.paymentsService.getPaymentUrl(data.orderId);
  }

  @MessagePattern(PAYMENT_MESSAGE_PATTERN.GET_PAYMENT_OPTIONS)
  getPaymentOptions(): Promise<
    Array<{ id: string; name: string; description: string }>
  > {
    return this.paymentsService.getPaymentOptions();
  }

  @Post("zalopay/callback")
  @Public()
  async zaloPayCallback(
    @Body() body: { data: string; mac: string },
  ): Promise<{ return_code: number; return_message: string }> {
    return handleZaloPayCallback(body, this.paymentsService);
  }

  @Post("vnpay/callback")
  @Public()
  async vnpayCallback(
    @Body() body: Record<string, string>,
  ): Promise<{ RspCode: string; Message: string }> {
    return handleVNPayCallback(
      body as { vnp_TxnRef: string; vnp_TransactionNo: string } & Record<
        string,
        string
      >,
      this.vnpayStrategy,
      this.paymentsService,
    );
  }

  @Get("vnpay/callback")
  @Public()
  async vnpayIpnCallback(
    @Query() query: Record<string, string>,
  ): Promise<{ RspCode: string; Message: string }> {
    return handleVNPayCallback(
      query as { vnp_TxnRef: string; vnp_TransactionNo: string } & Record<
        string,
        string
      >,
      this.vnpayStrategy,
      this.paymentsService,
    );
  }
}
