import { Controller, Logger, UseFilters } from "@nestjs/common";
import { Ctx, EventPattern, Payload, RmqContext } from "@nestjs/microservices";
import { RewardsService } from "./rewards.service";
import { EVENT } from "@app/common/constants/event";
import { HttpToRpcExceptionFilter } from "@app/common";

@UseFilters(HttpToRpcExceptionFilter)
@Controller()
export class RewardsController {
  private readonly logger = new Logger(RewardsController.name);

  constructor(private readonly rewardsService: RewardsService) {}

  @EventPattern(EVENT.PAYMENT_COMPLETED_EVENT)
  handlePaymentCompleted(): void {}

  @EventPattern(EVENT.ORDER_CREATED_EVENT)
  async handleOrderCreated(
    @Payload()
    order: { id: number; user_id: number; total: number },
    @Ctx() context: RmqContext,
  ) {
    void context;
    this.logger.log(`[REWARDS] Received order_created for order: ${order.id}`);
    await this.rewardsService.addRewards(order);
  }
}
