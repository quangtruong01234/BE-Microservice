import { Module } from "@nestjs/common";
import { ClientsModule, Transport } from "@nestjs/microservices";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";
import { ChatController } from "./chat.controller";
import { ChatGatewayService } from "./chat.service";

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.CHAT_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.CHAT_SERVICE_PORT,
        },
      },
    ]),
  ],
  controllers: [ChatController],
  providers: [ChatGatewayService],
})
export class ChatGatewayModule {}
