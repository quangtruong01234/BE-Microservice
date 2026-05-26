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

    const payment = this.paymentRepository.create({
      order_id: Number(orderId),
      amount,
      status: PaymentStatus.PENDING,
    });
    await this.paymentRepository.save(payment);

    const { paymentUrl, transactionId, appTransId } = await this.factory
      .getStrategy()
      .createPayment({ id: orderId, total: amount });

    await this.paymentRepository.update(
      { order_id: Number(orderId) },
      { order_url: paymentUrl, zp_trans_token: transactionId, appTransId },
    );

    return { paymentUrl, transactionId, appTransId };
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
      { status: PaymentStatus.COMPLETED, zp_trans_token: zpTransId },
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
