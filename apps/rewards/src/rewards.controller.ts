import { Controller, Logger } from "@nestjs/common";
import { Ctx, EventPattern, Payload, RmqContext } from "@nestjs/microservices";
import { RewardsService } from "./rewards.service";
import { EVENT } from "@app/common/constants/event";

// console.log('Listening for event pattern:', EVENT.ORDER_CREATED_EVENT);

@Controller()
export class RewardsController {
  private readonly logger = new Logger(RewardsController.name);

  constructor(
    private readonly rewardsService: RewardsService,
    // private readonly rmqService: RmqService,
  ) {}

  @EventPattern(EVENT.ORDER_CREATED_EVENT)
  async handleOrderCreated(
    @Payload() data: { id?: string | number },
    @Ctx() context: RmqContext,
  ) {
    void context;
    this.logger.log(
      `[REWARDS] Received event for order: ${String(data.id ?? "")}`,
    );

    // Gọi service để xử lý nghiệp vụ cộng điểm thưởng
    await this.rewardsService.addRewards(data);

    // // Xác nhận đã xử lý xong message để RabbitMQ xóa nó khỏi queue
    // this.rmqService.ack(context);
    // this.logger.log(`[REWARDS] Acknowledged event for order ${data.id}`);
  }
}
