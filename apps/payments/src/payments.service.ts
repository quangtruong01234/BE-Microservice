import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Channel } from "amqplib";
import { Payment, PaymentStatus } from "./entity/payment.entity";
import { EXCHANGE } from "@app/common/constants/exchange";
import { EVENT } from "@app/common/constants/event";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @Inject(EXCHANGE.RMQ_PUBLISHER_CHANNEL)
    private readonly publisherChannel: Channel,
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

    await new Promise((resolve) => setTimeout(resolve, 200));

    await this.paymentRepository.update(payment.id, {
      status: PaymentStatus.COMPLETED,
    });

    this.logger.log(
      `[PAYMENTS] Payment ${payment.id} completed for order ${orderId}`,
    );

    await this.publisherChannel.assertExchange(
      EXCHANGE.PAYMENTS_EXCHANGE,
      "fanout",
      { durable: true },
    );
    this.publisherChannel.publish(
      EXCHANGE.PAYMENTS_EXCHANGE,
      EVENT.PAYMENT_COMPLETED_EVENT,
      Buffer.from(
        JSON.stringify({
          data: { orderId },
          pattern: EVENT.PAYMENT_COMPLETED_EVENT,
        }),
      ),
    );

    this.logger.log(
      `[PAYMENTS] Emitted payment_completed for order ${orderId}`,
    );
  }
}
