import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Payment, PaymentStatus } from "./entity/payment.entity";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
  ) {}

  async processPayment(order: {
    id?: string | number;
    total?: number;
  }): Promise<void> {
    const orderId = Number(order.id ?? 0);
    const amount = Number(order.total ?? 0);

    this.logger.log(`[PAYMENTS] Processing payment for order ${orderId}...`);

    const payment = this.paymentRepository.create({
      order_id: orderId,
      amount,
      status: PaymentStatus.PENDING,
    });
    await this.paymentRepository.save(payment);

    // Simulate async processing (e.g., payment gateway call)
    await new Promise((resolve) => setTimeout(resolve, 200));

    await this.paymentRepository.update(payment.id, {
      status: PaymentStatus.COMPLETED,
    });

    this.logger.log(
      `[PAYMENTS] Payment ${payment.id} completed for order ${orderId}`,
    );
  }
}
