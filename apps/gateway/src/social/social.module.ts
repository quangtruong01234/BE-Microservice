import { Module } from "@nestjs/common";
import { ResilientClientTCP } from "@app/common";
import { ClientsModule } from "@nestjs/microservices";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";
import { SocialController } from "./social.controller";
import { SocialAdminController } from "./social-admin.controller";
import { SocialCommentController } from "./social-comment.controller";
import { SocialFollowController } from "./social-follow.controller";
import { SocialGatewayService } from "./social.service";
import { OptionalJwtAuthGuard } from "../common/guards/optional-jwt-auth.guard";

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.SOCIAL_SERVICE,
        customClass: ResilientClientTCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.SOCIAL_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.USER_SERVICE,
        customClass: ResilientClientTCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.USER_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.PRODUCT_SERVICE,
        customClass: ResilientClientTCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.PRODUCT_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [
    SocialController,
    SocialAdminController,
    SocialCommentController,
    SocialFollowController,
  ],
  providers: [SocialGatewayService, OptionalJwtAuthGuard],
})
export class SocialGatewayModule {}
