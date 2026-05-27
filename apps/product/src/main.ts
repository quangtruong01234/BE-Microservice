import { NestFactory } from "@nestjs/core";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { ProductModule } from "./product.module";
import { RmqService } from "@app/common";
import { QUEUES } from "@app/common/constants/queues";
import { EXCHANGE } from "@app/common/constants/exchange";
import { PORT_TCP, TCP_HOST } from "libs/constant/port-tcp.constant";
import { AllRpcExceptionFilter } from "./filters/rpc-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(ProductModule);

  const rmqService = app.get<RmqService>(RmqService);

  app.connectMicroservice<MicroserviceOptions>(
    rmqService.getOptionsTopic(QUEUES.INVENTORY_EVENTS, false, {
      name: EXCHANGE.INVENTORY_EXCHANGE,
      type: "fanout",
    }),
  );

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: TCP_HOST,
      port: PORT_TCP.PRODUCT_TCP_PORT,
    },
  });

  app.useGlobalFilters(new AllRpcExceptionFilter());

  await app.startAllMicroservices();
  await app.listen(PORT_TCP.PRODUCT_TCP_PORT + 100);

  console.log("✅ Product service is running:");
  console.log(`   🔌 TCP Microservice: localhost:${PORT_TCP.PRODUCT_TCP_PORT}`);
  console.log(`   📨 RabbitMQ Consumer: ${QUEUES.INVENTORY_EVENTS}`);
}
void bootstrap();
