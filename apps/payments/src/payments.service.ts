import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Payment, PaymentStatus } from "./entity/payment.entity";
import { ZaloPayService } from "./zalopay/zalopay.service";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly zaloPayService = new ZaloPayService();

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
  ) {}

  async processPayment(
    orderId: string,
    amount: number,
    description: string,
  ): Promise<{ order_url?: string; zp_trans_token?: string }> {
    this.logger.log(`[PAYMENTS] Processing payment for order ${orderId}...`);

    const payment = this.paymentRepository.create({
      order_id: Number(orderId),
      amount,
      status: PaymentStatus.PENDING,
    });
    await this.paymentRepository.save(payment);

    const result = await this.zaloPayService.createOrder(orderId, amount, description);
    if (result.return_code !== 1) {
      throw new Error(result.return_message);
    }

    await this.paymentRepository.update(
      { order_id: Number(orderId) },
      { order_url: result.order_url ?? null, zp_trans_token: result.zp_trans_token ?? null },
    );

    return { order_url: result.order_url, zp_trans_token: result.zp_trans_token };
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
