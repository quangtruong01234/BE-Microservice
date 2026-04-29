import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class RewardsService {
    private readonly logger = new Logger(RewardsService.name);

    async addRewards(order: any) {
        // ... Logic nghiệp vụ cộng điểm thưởng cho khách hàng ở đây ...
        this.logger.log(`Adding rewards for customer on order ${order.id}...`);

        // Giả lập một tác vụ mất thời gian
        await new Promise(resolve => setTimeout(resolve, 500));

        this.logger.log(`Rewards added successfully for order ${order.id}.`);
    }
}