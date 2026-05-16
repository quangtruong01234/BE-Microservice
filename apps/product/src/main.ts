import { NestFactory } from "@nestjs/core";
import { ProductModule } from "./product.module";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import * as dotenv from "dotenv";
import { PORT_TCP, TCP_HOST } from "libs/constant/port-tcp.constant";
import { AllRpcExceptionFilter } from "./filters/rpc-exception.filter";

async function bootstrap() {
  dotenv.config({ path: "./local/nodeA/.env" });
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    ProductModule,
    {
      transport: Transport.TCP,
      options: {
        host: TCP_HOST,
        port: PORT_TCP.PRODUCT_TCP_PORT,
      },
    },
  );

  // Enable global RPC exception filter
  app.useGlobalFilters(new AllRpcExceptionFilter());

  await app.listen();
  console.log(
    `Product microservice is listening on port ${PORT_TCP.PRODUCT_TCP_PORT}`,
  );
}
void bootstrap();
