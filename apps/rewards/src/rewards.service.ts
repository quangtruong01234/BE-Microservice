import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  async addRewards(order: { id?: string | number }) {
    this.logger.log(
      `Adding rewards for customer on order ${String(order.id ?? "")}...`,
    );

    await new Promise((resolve) => setTimeout(resolve, 500));

    this.logger.log(
      `Rewards added successfully for order ${String(order.id ?? "")}.`,
    );
  }
}
