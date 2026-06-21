import { Controller, Logger, UseFilters } from "@nestjs/common";
import { Ctx, EventPattern, Payload, RmqContext } from "@nestjs/microservices";
import { RewardsService } from "./rewards.service";
import { EVENT } from "@app/common/constants/event";
import { HttpToRpcExceptionFilter, RmqService } from "@app/common";

@UseFilters(HttpToRpcExceptionFilter)
@Controller()
export class RewardsController {
  private readonly logger = new Logger(RewardsController.name);

  constructor(
    private readonly rewardsService: RewardsService,
    private readonly rmqService: RmqService,
  ) {}

  @EventPattern(EVENT.PAYMENT_COMPLETED_EVENT)
  handlePaymentCompleted(): void {}

  @EventPattern(EVENT.ORDER_CREATED_EVENT)
  async handleOrderCreated(
    @Payload()
    order: { id: number; userId: number; total: number },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    try {
      this.logger.log(
        `[REWARDS] Received order_created for order: ${order.id}`,
      );
      await this.rewardsService.addRewards(order);
      this.rmqService.ack(context);
    } catch (error: unknown) {
      this.logger.error(
        `[REWARDS] Failed to process order_created for order ${order.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      const channel = context.getChannelRef() as {
        nack: (message: unknown, allUpTo: boolean, requeue: boolean) => void;
      };
      channel.nack(context.getMessage(), false, true);
    }
  }
}
