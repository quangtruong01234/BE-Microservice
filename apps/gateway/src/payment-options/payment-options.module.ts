import { Module } from "@nestjs/common";
import { ResilientClientTCP } from "@app/common";
import { ClientsModule } from "@nestjs/microservices";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";
import { PaymentOptionsController } from "./payment-options.controller";
import { PaymentOptionsService } from "./payment-options.service";

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.PAYMENT_SERVICE,
        customClass: ResilientClientTCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.PAYMENT_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [PaymentOptionsController],
  providers: [PaymentOptionsService],
})
export class PaymentOptionsModule {}
