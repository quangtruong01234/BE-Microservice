import { Module } from "@nestjs/common";
import { ResilientClientTCP } from "@app/common";
import { ClientsModule } from "@nestjs/microservices";
import { OrderService } from "./order.service";
import { OrderController } from "./order.controller";
import { CachedModule } from "@app/cached";
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
      {
        name: NAME_SERVICE_TCP.PAYMENT_SERVICE,
        customClass: ResilientClientTCP,
        options: { host: TCP_HOST, port: PORT_TCP.PAYMENT_TCP_PORT },
      },
      {
        name: NAME_SERVICE_TCP.USER_SERVICE,
        customClass: ResilientClientTCP,
        options: { host: TCP_HOST, port: PORT_TCP.USER_TCP_PORT },
      },
      {
        name: NAME_SERVICE_TCP.PRODUCT_SERVICE,
        customClass: ResilientClientTCP,
        options: { host: TCP_HOST, port: PORT_TCP.PRODUCT_TCP_PORT },
      },
    ]),
    CachedModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
