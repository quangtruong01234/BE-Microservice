import { NestFactory } from "@nestjs/core";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import * as dotenv from "dotenv";
import { PORT_TCP, TCP_HOST } from "libs/constant/port-tcp.constant";
import { RmqService } from "@app/common";
import { EXCHANGE } from "@app/common/constants/exchange";
import { NotificationModule } from "./notification.module";

async function bootstrap(): Promise<void> {
  dotenv.config({ path: "./local/nodeA/.env" });

  const app = await NestFactory.create(NotificationModule);

  // TCP for synchronous queries from gateway
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: TCP_HOST,
      port: PORT_TCP.NOTIFICATION_TCP_PORT,
    },
  });

  // RabbitMQ: consume payment_completed events (fanout)
  const rmqService = app.get<RmqService>(RmqService);
  app.connectMicroservice(
    rmqService.getOptionsTopic("NOTIFICATION_SERVICE", false, {
      name: EXCHANGE.PAYMENTS_EXCHANGE,
      type: "fanout",
    }),
  );

  // RabbitMQ: consume order_canceled events (fanout)
  app.connectMicroservice(
    rmqService.getOptionsTopic("NOTIFICATION_ORDERS_SERVICE", false, {
      name: EXCHANGE.ORDERS_EXCHANGE,
      type: "fanout",
    }),
  );

  // RabbitMQ: consume social comment/reply events (fanout)
  app.connectMicroservice(
    rmqService.getOptionsTopic("NOTIFICATION_SOCIAL_SERVICE", false, {
      name: EXCHANGE.SOCIAL_EXCHANGE,
      type: "fanout",
    }),
  );

  // RabbitMQ: consume product brand/category review events (fanout)
  app.connectMicroservice(
    rmqService.getOptionsTopic("NOTIFICATION_PRODUCT_SERVICE", false, {
      name: EXCHANGE.PRODUCT_EXCHANGE,
      type: "fanout",
    }),
  );

  await app.startAllMicroservices();
  await app.init();
  console.log(
    `Notification service running: TCP :${PORT_TCP.NOTIFICATION_TCP_PORT} + RMQ ${EXCHANGE.PAYMENTS_EXCHANGE} + ${EXCHANGE.ORDERS_EXCHANGE} + ${EXCHANGE.SOCIAL_EXCHANGE} + ${EXCHANGE.PRODUCT_EXCHANGE}`,
  );
}
void bootstrap();
