import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  SetMetadata,
  UseFilters,
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
import {
  HttpToRpcExceptionFilter,
  PaymentMethod,
  RmqService,
} from "@app/common";
import { ZaloPayReturnQuery } from "./zalopay/zalopay.service";

const Public = () => SetMetadata("isPublic", true);

@UseFilters(HttpToRpcExceptionFilter)
@Controller()
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly vnpayStrategy: VNPayStrategy,
    private readonly rmqService: RmqService,
  ) {}

  @EventPattern(EVENT.PAYMENT_COMPLETED_EVENT)
  handlePaymentCompleted(): void {}

  @EventPattern(EVENT.ORDER_CREATED_EVENT)
  async handleOrderCreated(
    @Payload()
    order: {
      id: number;
      total: number;
      paymentMethod?: PaymentMethod;
      isMultiSellerCheckout?: boolean;
    },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    try {
      if (order.isMultiSellerCheckout) {
        this.logger.log(
          `[PAYMENTS] order_created for multi-seller child order ${order.id} — payment handled by multi-order flow`,
        );
        this.rmqService.ack(context);
        return;
      }
      if (order.paymentMethod === PaymentMethod.COD) {
        this.rmqService.ack(context);
        return;
      }
      if (!order.paymentMethod) {
        this.logger.warn(
          `[PAYMENTS] order_created for order ${order.id} has no paymentMethod — skipping payment creation`,
        );
        this.rmqService.ack(context);
        return;
      }
      this.logger.log(
        `[PAYMENTS] Received order_created for order: ${order.id}`,
      );
      await this.paymentsService.processPayment(
        String(order.id),
        order.total,
        `Payment for order ${order.id}`,
        order.paymentMethod,
      );
      this.rmqService.ack(context);
    } catch (error: unknown) {
      this.logger.error(
        `[PAYMENTS] Failed to process order_created for order ${order.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      const channel = context.getChannelRef() as {
        nack: (message: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      channel.nack(context.getMessage(), false, true);
    }
  }

  @MessagePattern("get_payment_url")
  getPaymentUrl(
    @Payload() data: { orderId: number },
  ): Promise<{ orderUrl: string | null; status: string | null }> {
    return this.paymentsService.getPaymentUrl(data.orderId);
  }

  @MessagePattern(PAYMENT_MESSAGE_PATTERN.GET_PAYMENT_OPTIONS)
  getPaymentOptions(): Promise<
    Array<{ id: string; name: string; description: string }>
  > {
    return this.paymentsService.getPaymentOptions();
  }

  @MessagePattern(PAYMENT_MESSAGE_PATTERN.INITIATE_MULTI_ORDER_PAYMENT)
  initiateMultiOrderPayment(
    @Payload()
    data: {
      orderIds: number[];
      totalAmount: number;
      paymentMethod: PaymentMethod;
    },
  ): Promise<{
    paymentUrl: string;
    transactionId: string;
    appTransId: string;
  }> {
    return this.paymentsService.processMultiOrderPayment(
      data.orderIds,
      data.totalAmount,
      data.paymentMethod,
    );
  }

  @MessagePattern(PAYMENT_MESSAGE_PATTERN.COMPLETE_ZALOPAY_RETURN)
  async completeZaloPayReturn(
    @Payload() query: ZaloPayReturnQuery,
  ): Promise<{ status: "success" | "failed" }> {
    if (!this.zaloPayReturnHasValidShape(query)) {
      return { status: "failed" };
    }
    if (!this.paymentsService.verifyZaloPayReturn(query)) {
      return { status: "failed" };
    }
    if (query.status !== "1") {
      return { status: "failed" };
    }
    await this.paymentsService.completeZaloPayReturn(
      query.apptransid,
      query.apptransid,
    );
    return { status: "success" };
  }

  @MessagePattern(PAYMENT_MESSAGE_PATTERN.COMPLETE_VNPAY_RETURN)
  async completeVNPayReturn(
    @Payload()
    query: { vnp_TxnRef?: string; vnp_TransactionNo?: string } & Record<
      string,
      string | undefined
    >,
  ): Promise<{ status: "success" | "failed" }> {
    if (!query.vnp_TxnRef || !query.vnp_TransactionNo) {
      return { status: "failed" };
    }
    const { success } = await this.vnpayStrategy.verifyCallback(query);
    if (!success) {
      return { status: "failed" };
    }
    await this.paymentsService.completeVNPayPayment(
      query.vnp_TxnRef,
      query.vnp_TransactionNo,
    );
    return { status: "success" };
  }

  private zaloPayReturnHasValidShape(
    query: Partial<ZaloPayReturnQuery>,
  ): query is ZaloPayReturnQuery {
    return [
      query.appid,
      query.apptransid,
      query.pmcid,
      query.bankcode,
      query.amount,
      query.discountamount,
      query.status,
      query.checksum,
    ].every((value) => typeof value === "string");
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
