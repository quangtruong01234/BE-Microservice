import { Controller, Logger } from "@nestjs/common";
import { Ctx, EventPattern, Payload, RmqContext } from "@nestjs/microservices";
import { RewardsService } from "./rewards.service";
import { EVENT } from "@app/common/constants/event";

@Controller()
export class RewardsController {
  private readonly logger = new Logger(RewardsController.name);

  constructor(private readonly rewardsService: RewardsService) {}

  @EventPattern(EVENT.ORDER_CREATED_EVENT)
  async handleOrderCreated(
    @Payload()
    data: { data: { id: number; user_id: number; total: number } },
    @Ctx() context: RmqContext,
  ) {
    void context;
    const order = data.data;
    this.logger.log(`[REWARDS] Received order_created for order: ${order.id}`);
    await this.rewardsService.addRewards(order);
  }
}
