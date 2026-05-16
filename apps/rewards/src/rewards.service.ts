import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { RewardPoint } from "./entity/reward_point.entity";

// 1 point per 10,000 VND
const POINTS_PER_VND = 10000;

@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(
    @InjectRepository(RewardPoint)
    private readonly rewardRepository: Repository<RewardPoint>,
  ) {}

  async addRewards(order: {
    id?: string | number;
    user_id?: number;
    total?: number;
  }): Promise<void> {
    const orderId = Number(order.id ?? 0);
    const userId = Number(order.user_id ?? 0);
    const total = Number(order.total ?? 0);
    const points = Math.floor(total / POINTS_PER_VND);

    if (points <= 0) {
      this.logger.log(
        `[REWARDS] Order ${orderId} total ${total} yields 0 points — skipping`,
      );
      return;
    }

    const record = this.rewardRepository.create({
      user_id: userId,
      order_id: orderId,
      points,
    });
    await this.rewardRepository.save(record);

    this.logger.log(
      `[REWARDS] Added ${points} points for user ${userId} on order ${orderId}`,
    );
  }

  async getUserPoints(userId: number): Promise<number> {
    const result = await this.rewardRepository
      .createQueryBuilder("rp")
      .select("SUM(rp.points)", "total")
      .where("rp.user_id = :userId", { userId })
      .getRawOne<{ total: string | null }>();
    return Number(result?.total ?? 0);
  }
}
