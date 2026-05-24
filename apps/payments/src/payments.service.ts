import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Payment, PaymentStatus } from "./entity/payment.entity";
import { PaymentGatewayFactory } from "./payment-gateway.factory";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly factory: PaymentGatewayFactory,
  ) {}

  async processPayment(
    orderId: string,
    amount: number,
    description: string,
  ): Promise<{ paymentUrl: string; transactionId: string; appTransId: string }> {
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
