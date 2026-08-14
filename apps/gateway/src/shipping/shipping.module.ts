import { Module } from "@nestjs/common";
import { ResilientClientTCP } from "@app/common";
import { ClientsModule } from "@nestjs/microservices";
import { ShippingController } from "./shipping.controller";
import { ShippingService } from "./shipping.service";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.ORDERS_SERVICE,
        customClass: ResilientClientTCP,
        options: { host: TCP_HOST, port: PORT_TCP.ORDERS_TCP_PORT },
      },
    ]),
  ],
  controllers: [ShippingController],
  providers: [ShippingService],
})
export class ShippingModule {}
