import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RmqModule, RmqService } from "@app/common";
import { PostgresDatabaseModule } from "@app/database";
import { RewardsController } from "./rewards.controller";
import { RewardsService } from "./rewards.service";
import { RewardPoint } from "./entity/reward_point.entity";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeB/.env",
    }),
    PostgresDatabaseModule,
    TypeOrmModule.forFeature([RewardPoint]),
    RmqModule,
  ],
  controllers: [RewardsController],
  providers: [RewardsService, RmqService],
})
export class RewardsModule {}
