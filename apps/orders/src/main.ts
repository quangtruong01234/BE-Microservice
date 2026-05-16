import { NestFactory } from "@nestjs/core";
import { OrdersModule } from "./orders.module";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { ValidationPipe } from "@nestjs/common";
import * as dotenv from "dotenv";
import { PORT_TCP, TCP_HOST } from "libs/constant/port-tcp.constant";
import { AllRpcExceptionFilter } from "./filters/rpc-exception.filter";

async function bootstrap() {
  dotenv.config({ path: "./local/nodeA/.env" });
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    OrdersModule,
    {
      transport: Transport.TCP,
      options: {
        host: TCP_HOST,
        port: PORT_TCP.ORDERS_TCP_PORT, // Port phải khớp với cấu hình ở GatewayModule
      },
    },
  );

  // Enable global RPC exception filter
  app.useGlobalFilters(new AllRpcExceptionFilter());

  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false, // Allow extra properties for microservice flexibility
    }),
  );

  await app.listen();
  console.log(
    `Orders microservice is listening on port ${PORT_TCP.ORDERS_TCP_PORT}`,
  );
}
void bootstrap();
