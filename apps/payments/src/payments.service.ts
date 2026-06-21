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
import { PaymentMethod } from "./entity/payment-method.entity";
import { PaymentMethod as PaymentMethodEnum } from "@app/common";
import { PaymentGatewayFactory } from "./payment-gateway.factory";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(PaymentMethod)
    private readonly paymentMethodRepository: Repository<PaymentMethod>,
    private readonly factory: PaymentGatewayFactory,
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly fanoutChannel: Channel,
  ) {}

  async processPayment(
    orderId: string,
    amount: number,
    description: string,
    paymentMethod: PaymentMethodEnum,
  ): Promise<{
    paymentUrl: string;
    transactionId: string;
    appTransId: string;
  }> {
    void description;
    this.logger.log(`[PAYMENTS] Processing payment for order ${orderId}...`);

    try {
      const existing = await this.paymentRepository.findOne({
        where: { orderId: Number(orderId) },
      });
      if (existing) {
        this.logger.warn(
          `[PAYMENTS] Duplicate orderId ${orderId} detected, skipping`,
        );
        return {
          paymentUrl: existing.orderUrl ?? "",
          transactionId: existing.transactionId ?? "",
          appTransId: existing.appTransId ?? "",
        };
      }

      const payment = this.paymentRepository.create({
        orderId: Number(orderId),
        amount,
        status: PaymentStatus.PENDING,
      });
      await this.paymentRepository.save(payment);
      this.logger.log("[PAYMENTS] payment record saved");

      const { paymentUrl, transactionId, appTransId } = await this.factory
        .getStrategy(paymentMethod)
        .createPayment({ id: orderId, total: amount });
      this.logger.log(
        "[PAYMENTS] createPayment done, appTransId=" + appTransId,
      );

      const updateResult = await this.paymentRepository.update(
        { orderId: Number(orderId) },
        { orderUrl: paymentUrl, transactionId, appTransId },
      );
      this.logger.log("[PAYMENTS] payment record updated with appTransId");
      if (updateResult.affected === 0) {
        throw new InternalServerErrorException(
          "Failed to persist appTransId — payment row not found by orderId",
        );
      }

      return { paymentUrl, transactionId, appTransId };
    } catch (err: unknown) {
      this.logger.error("[PAYMENTS] processPayment failed", err);
      throw err;
    }
  }

  async processMultiOrderPayment(
    orderIds: number[],
    totalAmount: number,
    paymentMethod: PaymentMethodEnum,
  ): Promise<{
    paymentUrl: string;
    transactionId: string;
    appTransId: string;
  }> {
    this.logger.log(
      `[PAYMENTS] Processing multi-order payment for orders [${orderIds.join(",")}]`,
    );

    try {
      const payment = this.paymentRepository.create({
        orderId: null,
        orderIds,
        amount: totalAmount,
        status: PaymentStatus.PENDING,
      });
      await this.paymentRepository.save(payment);
      this.logger.log(
        `[PAYMENTS] multi-order payment record saved id=${payment.id}`,
      );

      const { paymentUrl, transactionId, appTransId } = await this.factory
        .getStrategy(paymentMethod)
        .createPayment({ id: String(payment.id), total: totalAmount });
      this.logger.log(
        "[PAYMENTS] createPayment done, appTransId=" + appTransId,
      );

      const updateResult = await this.paymentRepository.update(
        { id: payment.id },
        { orderUrl: paymentUrl, transactionId, appTransId },
      );
      if (updateResult.affected === 0) {
        throw new InternalServerErrorException(
          "Failed to persist appTransId — multi-order payment row not found",
        );
      }

      return { paymentUrl, transactionId, appTransId };
    } catch (err: unknown) {
      this.logger.error("[PAYMENTS] processMultiOrderPayment failed", err);
      throw err;
    }
  }

  private emitPaymentCompleted(orderId: number, amount: number): void {
    const eventPayload = {
      data: { orderId, amount },
      pattern: EVENT.PAYMENT_COMPLETED_EVENT,
    };
    this.fanoutChannel.publish(
      EXCHANGE.PAYMENTS_EXCHANGE,
      EVENT.PAYMENT_COMPLETED_EVENT,
      Buffer.from(JSON.stringify(eventPayload)),
    );
  }

  async completeZaloPayPayment(
    appTransId: string,
    zpTransId: string,
  ): Promise<Payment> {
    return this.completePayment(appTransId, zpTransId, "ZaloPay");
  }

  async completeVNPayPayment(
    vnpTxnRef: string,
    vnpTransactionNo: string,
  ): Promise<Payment> {
    return this.completePayment(vnpTxnRef, vnpTransactionNo, "VNPay");
  }

  private async completePayment(
    appTransId: string,
    transactionId: string,
    gateway: "ZaloPay" | "VNPay",
  ): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { appTransId },
    });
    if (!payment) {
      throw new NotFoundException(`Payment ${appTransId} not found`);
    }
    if (payment.status === PaymentStatus.COMPLETED) {
      this.logger.log(
        `[PAYMENTS] Duplicate ${gateway} callback ignored appTransId=${appTransId}`,
      );
      return payment;
    }

    const updateResult = await this.paymentRepository.update(
      { id: payment.id, status: PaymentStatus.PENDING },
      { status: PaymentStatus.COMPLETED, transactionId },
    );
    if (updateResult.affected !== 1) {
      const current = await this.paymentRepository.findOne({
        where: { id: payment.id },
      });
      if (current?.status === PaymentStatus.COMPLETED) {
        this.logger.log(
          `[PAYMENTS] Concurrent ${gateway} callback ignored appTransId=${appTransId}`,
        );
        return current;
      }
      throw new InternalServerErrorException("Payment completion failed");
    }

    const updated = await this.paymentRepository.findOne({
      where: { id: payment.id },
    });
    if (!updated) {
      throw new InternalServerErrorException("Payment update failed");
    }

    const orderIdList =
      updated.orderIds ?? (updated.orderId !== null ? [updated.orderId] : []);
    for (const orderId of orderIdList) {
      this.emitPaymentCompleted(orderId, updated.amount);
    }

    this.logger.log(
      `[PAYMENTS] ${gateway} payment completed appTransId=${appTransId} orderIds=[${orderIdList.join(",")}]`,
    );
    return updated;
  }

  async getPaymentUrl(
    orderId: number,
  ): Promise<{ orderUrl: string | null; status: string | null }> {
    let payment = await this.paymentRepository.findOne({
      where: { orderId },
    });
    if (!payment) {
      // Multi-order payments store order_id = NULL and the IDs in order_ids (JSONB)
      payment = await this.paymentRepository
        .createQueryBuilder("payment")
        .where("payment.order_ids @> CAST(:ids AS jsonb)", {
          ids: JSON.stringify([orderId]),
        })
        .orderBy("payment.created_at", "DESC")
        .getOne();
    }
    return {
      orderUrl: payment?.orderUrl ?? null,
      status: payment?.status ?? null,
    };
  }

  async getPaymentOptions(): Promise<
    Array<{ id: string; name: string; description: string }>
  > {
    const methods = await this.paymentMethodRepository.find({
      where: { isActive: true },
      order: { id: "ASC" },
    });
    return methods.map((m) => ({
      id: m.key,
      name: m.name,
      description: m.description,
    }));
  }
}
