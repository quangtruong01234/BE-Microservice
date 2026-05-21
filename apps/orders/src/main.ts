import { NestFactory } from "@nestjs/core";
import { OrdersModule } from "./orders.module";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { ValidationPipe } from "@nestjs/common";
import * as dotenv from "dotenv";
import { PORT_TCP, TCP_HOST } from "libs/constant/port-tcp.constant";
import { AllRpcExceptionFilter } from "./filters/rpc-exception.filter";
import { RmqService } from "@app/common";
import { EXCHANGE } from "@app/common/constants/exchange";

async function bootstrap() {
  dotenv.config({ path: "./local/nodeA/.env" });

  const app = await NestFactory.create(OrdersModule);

  app.useGlobalFilters(new AllRpcExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  // TCP transport for synchronous RPC (create_order, get_orders_by_user, etc.)
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: TCP_HOST,
      port: PORT_TCP.ORDERS_TCP_PORT,
    },
  });

  // RMQ fanout subscriber for payment_completed events
  const rmqService = app.get<RmqService>(RmqService);
  app.connectMicroservice(
    rmqService.getOptionsTopic("ORDERS_SERVICE", false, {
      name: EXCHANGE.PAYMENTS_EXCHANGE,
      type: "fanout",
    }),
  );

  await app.startAllMicroservices();
  console.log(
    `Orders service running: TCP :${PORT_TCP.ORDERS_TCP_PORT} + RMQ ${EXCHANGE.PAYMENTS_EXCHANGE}`,
  );
}
void bootstrap();
