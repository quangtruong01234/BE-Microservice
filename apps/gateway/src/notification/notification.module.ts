import { Module } from "@nestjs/common";
import { ClientsModule, Transport } from "@nestjs/microservices";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";
import { NotificationController } from "./notification.controller";
import { NotificationGatewayService } from "./notification.service";

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.NOTIFICATION_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.NOTIFICATION_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [NotificationController],
  providers: [NotificationGatewayService],
})
export class NotificationGatewayModule {}
