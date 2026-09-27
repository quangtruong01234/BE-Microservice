import { Module } from "@nestjs/common";
import { ResilientClientTCP } from "@app/common";
import { ClientsModule } from "@nestjs/microservices";
import { CachedModule } from "@app/cached";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";
import { UserService } from "./user.service";
import { UserController } from "./user.controller";

@Module({
  imports: [
    CachedModule,
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.USER_SERVICE,
        customClass: ResilientClientTCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.USER_TCP_PORT,
        },
      },
      // RAIL-RANK-01: featured sellers are ranked by units sold (orders DB).
      {
        name: NAME_SERVICE_TCP.ORDERS_SERVICE,
        customClass: ResilientClientTCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.ORDERS_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
