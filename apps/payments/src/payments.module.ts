import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RmqModule } from "@app/common";
import { PostgresDatabaseModule } from "@app/database";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { Payment } from "./entity/payment.entity";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeB/.env",
    }),
    PostgresDatabaseModule,
    TypeOrmModule.forFeature([Payment]),
    RmqModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
