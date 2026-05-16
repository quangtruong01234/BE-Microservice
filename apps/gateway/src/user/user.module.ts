import { Module } from "@nestjs/common";
import { ClientsModule, Transport } from "@nestjs/microservices";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";
import { UserService } from "./user.service";
import { UserController } from "./user.controller";

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.USER_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.USER_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
