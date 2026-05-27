import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Channel } from "amqplib";
import { Payment, PaymentStatus } from "./entity/payment.entity";
import { PaymentGatewayFactory } from "./payment-gateway.factory";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly factory: PaymentGatewayFactory,
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel,
  ) {}

  async processPayment(
    orderId: string,
    amount: number,
    description: string,
  ): Promise<{
    paymentUrl: string;
    transactionId: string;
    appTransId: string;
  }> {
    void description;
    this.logger.log(`[PAYMENTS] Processing payment for order ${orderId}...`);

    try {
      const existing = await this.paymentRepository.findOne({
        where: { order_id: Number(orderId) },
      });
      if (existing) {
        this.logger.warn(
          `[PAYMENTS] Duplicate order_id ${orderId} detected, skipping`,
        );
        return {
          paymentUrl: existing.order_url ?? "",
          transactionId: existing.transaction_id ?? "",
          appTransId: existing.appTransId ?? "",
        };
      }

      const payment = this.paymentRepository.create({
        order_id: Number(orderId),
        amount,
        status: PaymentStatus.PENDING,
      });
      await this.paymentRepository.save(payment);
      this.logger.log("[PAYMENTS] payment record saved");

      const { paymentUrl, transactionId, appTransId } = await this.factory
        .getStrategy()
        .createPayment({ id: orderId, total: amount });
      this.logger.log(
        "[PAYMENTS] createPayment done, appTransId=" + appTransId,
      );

      const updateResult = await this.paymentRepository.update(
        { order_id: Number(orderId) },
        { order_url: paymentUrl, transaction_id: transactionId, appTransId },
      );
      this.logger.log("[PAYMENTS] payment record updated with appTransId");
      if (updateResult.affected === 0) {
        throw new InternalServerErrorException(
          "Failed to persist appTransId — payment row not found by order_id",
        );
      }

      return { paymentUrl, transactionId, appTransId };
    } catch (err: unknown) {
      this.logger.error("[PAYMENTS] processPayment failed", err);
      throw err;
    }
  }

  async completeZaloPayPayment(
    appTransId: string,
    zpTransId: string,
  ): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { appTransId },
    });
    if (!payment) {
      throw new NotFoundException(
        `Payment with app_trans_id ${appTransId} not found`,
      );
    }

    await this.paymentRepository.update(
      { appTransId },
      { status: PaymentStatus.COMPLETED, transaction_id: zpTransId },
    );

    const updated = await this.paymentRepository.findOne({
      where: { appTransId },
    });
    if (!updated) {
      throw new InternalServerErrorException("Payment update failed");
    }

    const eventPayload = {
      data: { orderId: updated.order_id, amount: updated.amount },
      pattern: EVENT.PAYMENT_COMPLETED_EVENT,
    };
    this.fanoutChannel.publish(
      EXCHANGE.PAYMENTS_EXCHANGE,
      EVENT.PAYMENT_COMPLETED_EVENT,
      Buffer.from(JSON.stringify(eventPayload)),
    );

    this.logger.log(
      `[PAYMENTS] Payment completed orderId=${updated.order_id} appTransId=${appTransId}`,
    );
    return updated;
  }

  async completeVNPayPayment(
    vnpTxnRef: string,
    vnpTransactionNo: string,
  ): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { appTransId: vnpTxnRef },
    });
    if (!payment) {
      throw new NotFoundException(
        `Payment with vnp_TxnRef ${vnpTxnRef} not found`,
      );
    }

    const updateResult = await this.paymentRepository.update(
      { appTransId: vnpTxnRef },
      { status: PaymentStatus.COMPLETED, transaction_id: vnpTransactionNo },
    );
    if (updateResult.affected === 0) {
      throw new NotFoundException(
        `Payment update affected 0 rows for vnp_TxnRef ${vnpTxnRef}`,
      );
    }

    const updated = await this.paymentRepository.findOne({
      where: { appTransId: vnpTxnRef },
    });
    if (!updated) {
      throw new InternalServerErrorException("Payment update failed");
    }

    const eventPayload = {
      data: { orderId: updated.order_id, amount: updated.amount },
      pattern: EVENT.PAYMENT_COMPLETED_EVENT,
    };
    this.fanoutChannel.publish(
      EXCHANGE.PAYMENTS_EXCHANGE,
      EVENT.PAYMENT_COMPLETED_EVENT,
      Buffer.from(JSON.stringify(eventPayload)),
    );

    this.logger.log(
      `[PAYMENTS] VNPay payment completed orderId=${updated.order_id} vnp_TxnRef=${vnpTxnRef}`,
    );
    return updated;
  }

  async getPaymentUrl(
    orderId: number,
  ): Promise<{ order_url: string | null; status: string | null }> {
    const payment = await this.paymentRepository.findOne({
      where: { order_id: orderId },
    });
    return {
      order_url: payment?.order_url ?? null,
      status: payment?.status ?? null,
    };
  }
}
