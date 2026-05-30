import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { JwtModule } from "@nestjs/jwt";
import { RmqModule } from "@app/common";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";
import { NotificationWsGateway } from "./notification.ws-gateway";
import { Notification } from "./entities/notification.entity";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeA/.env",
    }),
    TypeOrmModule.forRoot({
      type: "mysql",
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT),
      username: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      entities: [Notification],
      synchronize: false,
    }),
    TypeOrmModule.forFeature([Notification]),
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.ORDERS_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.ORDERS_TCP_PORT,
        },
      },
    ]),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
      }),
    }),
    RmqModule,
  ],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationWsGateway],
  exports: [NotificationWsGateway],
})
export class NotificationModule {}
