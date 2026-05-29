import { Module } from "@nestjs/common";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { GatewayController } from "./gateway.controller";
import { GatewayService } from "./gateway.service";
import { InventoryModule } from "./inventory/inventory.module";
import { UserModule } from "./user/user.module";
import { OrderModule } from "./order/order.module";
import { ProductModule } from "./product/product.module";
import { GhnWebhookModule } from "./ghn/ghn-webhook.module";
import { PaymentOptionsModule } from "./payment-options/payment-options.module";
import { NotificationGatewayModule } from "./notification/notification.module";
import { CachedModule } from "@app/cached";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";
import { APP_GUARD } from "@nestjs/core";
import { CustomRateLimitGuard } from "./common/guards/rate-limit.guard";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RoleAuthGuard } from "./common/guards/role-auth.guard";

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: {
          expiresIn: (process.env.JWT_EXPIRES_IN ?? "1h") as "7d",
        },
      }),
    }),
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.ORDERS_SERVICE, // Tên token để inject
        transport: Transport.TCP,
        options: {
          host: TCP_HOST, // Hoặc địa chỉ IP của Orders service
          port: PORT_TCP.ORDERS_TCP_PORT, // Port mà Orders service sẽ lắng nghe
        },
      },
      {
        name: NAME_SERVICE_TCP.INVENTORY_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.INVENTORY_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.USER_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.USER_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.PRODUCT_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.PRODUCT_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.PAYMENT_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.PAYMENT_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.SOCIAL_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.SOCIAL_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.NOTIFICATION_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.NOTIFICATION_TCP_PORT,
        },
      },
    ]),
    InventoryModule,
    UserModule,
    OrderModule,
    ProductModule,
    CachedModule,
    GhnWebhookModule,
    PaymentOptionsModule,
    NotificationGatewayModule,
  ],
  controllers: [GatewayController],
  providers: [
    GatewayService,
    {
      provide: APP_GUARD,
      useClass: CustomRateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RoleAuthGuard,
    },
  ],
  exports: [ClientsModule],
})
export class GatewayModule {}
