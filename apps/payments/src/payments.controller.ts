import { Controller, Logger } from "@nestjs/common";
import { EventPattern, Payload } from "@nestjs/microservices";
import { PaymentsService } from "./payments.service";
import { EVENT } from "@app/common/constants/event";

@Controller()
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @EventPattern(EVENT.ORDER_CREATED_EVENT)
  async handleOrderCreated(@Payload() data: { id?: string | number }) {
    this.logger.log(
      `[PAYMENTS] Received event for order: ${String(data.id ?? "")}`,
    );

    // Gọi service để xử lý nghiệp vụ thanh toán
    await this.paymentsService.processPayment(data);
  }
}
