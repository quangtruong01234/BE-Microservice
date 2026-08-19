import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { CartController } from "./cart.controller";
import { CartService } from "./cart.service";
import { Cart } from "./entity/cart.entity";
import { CartItem } from "./entity/cart-item.entity";
import { AllRpcExceptionFilter } from "./filters/rpc-exception.filter";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ResilientClientTCP, RmqModule } from "@app/common";
import { CachedModule } from "@app/cached";
import { HttpModule } from "@nestjs/axios";
import { ClientsModule } from "@nestjs/microservices";
import { TypeOrmModule } from "@nestjs/typeorm";
import { resolveTypeOrmSynchronize } from "@app/database";
import { OrderItem } from "./entity/order_item.entity";
import { Order } from "./entity/order.entity";
import { OrderOutbox } from "./entity/order-outbox.entity";
import { ShippingHistory } from "./entity/shipping-history.entity";
import { OrderReturnRequest } from "./entity/order-return-request.entity";
import { Voucher } from "./entity/voucher.entity";
import { VoucherRedemption } from "./entity/voucher-redemption.entity";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";
import { GhnModule } from "./ghn/ghn.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeA/.env",
    }),
    ScheduleModule.forRoot(),
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5,
    }),
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.INVENTORY_SERVICE,
        customClass: ResilientClientTCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.INVENTORY_TCP_PORT,
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
    // RmqModule.register({ name: "INVENTORY_SERVICE" }),
    // RmqModule.register({ name: "PAYMENTS_SERVICE" }),
    GhnModule,
    CachedModule,
    RmqModule,
    RmqModule.registerDirectPublisher(),
    // TYPEORM_MODULE.forFeature([Order, OrderItem])
    TypeOrmModule.forRoot({
      type: "mysql",
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT),
      username: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      entities: [
        Order,
        OrderItem,
        OrderOutbox,
        Cart,
        CartItem,
        ShippingHistory,
        OrderReturnRequest,
        Voucher,
        VoucherRedemption,
      ],
      synchronize: resolveTypeOrmSynchronize(),
      timezone: "Z",
      extra: {
        connectionLimit: Number(process.env.MYSQL_POOL_SIZE) || 10,
      },
    }),
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderOutbox,
      Cart,
      CartItem,
      ShippingHistory,
      OrderReturnRequest,
      Voucher,
      VoucherRedemption,
    ]),
  ],
  controllers: [OrdersController, CartController],
  providers: [
    OrdersService,
    CartService,
    { provide: APP_FILTER, useClass: AllRpcExceptionFilter },
  ],
})
export class OrdersModule {}
