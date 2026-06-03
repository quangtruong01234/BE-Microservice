import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { AllRpcExceptionFilter } from "./filters/rpc-exception.filter";
import { ConfigModule } from "@nestjs/config";
import { RmqModule } from "@app/common";
import { HttpModule } from "@nestjs/axios";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OrderItem } from "./entity/order_item.entity";
import { Order } from "./entity/order.entity";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";
import { GhnModule } from "./ghn/ghn.module";

@Module({
  imports: [
    // MysqlModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeA/.env",
    }),
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5,
    }),
    ClientsModule.register([
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
    ]),
    // RmqModule.register({ name: "INVENTORY_SERVICE" }),
    // RmqModule.register({ name: "PAYMENTS_SERVICE" }),
    GhnModule,
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
      entities: [Order, OrderItem],
      synchronize: true,
      timezone: "Z",
    }),
    TypeOrmModule.forFeature([Order, OrderItem]),
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    { provide: APP_FILTER, useClass: AllRpcExceptionFilter },
  ],
})
export class OrdersModule {}
