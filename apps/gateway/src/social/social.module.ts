import { Module } from "@nestjs/common";
import { ClientsModule, Transport } from "@nestjs/microservices";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";
import { SocialController } from "./social.controller";
import { SocialCommentController } from "./social-comment.controller";
import { SocialGatewayService } from "./social.service";

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.SOCIAL_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.SOCIAL_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [SocialController, SocialCommentController],
  providers: [SocialGatewayService],
})
export class SocialGatewayModule {}
