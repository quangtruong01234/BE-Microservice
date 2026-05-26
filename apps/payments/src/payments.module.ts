import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RmqModule } from "@app/common";
import { PostgresDatabaseModule } from "@app/database";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { Payment } from "./entity/payment.entity";
import { ZaloPayService } from "./zalopay/zalopay.service";
import { VNPayStrategy } from "./vnpay/vnpay.service";
import { PaymentGatewayFactory } from "./payment-gateway.factory";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeB/.env",
    }),
    PostgresDatabaseModule,
    TypeOrmModule.forFeature([Payment]),
    RmqModule,
    RmqModule.registerDirectPublisher(),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    ZaloPayService,
    VNPayStrategy,
    PaymentGatewayFactory,
  ],
})
export class PaymentsModule {}
