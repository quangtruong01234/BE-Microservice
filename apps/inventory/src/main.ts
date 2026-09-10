import { NestFactory } from "@nestjs/core";
import { RmqService } from "@app/common";
import { InventoryModule } from "./inventory.module";
import { Transport, MicroserviceOptions } from "@nestjs/microservices";
import { PORT_TCP, TCP_HOST } from "libs/constant/port-tcp.constant";
import { AllRpcExceptionFilter } from "./filters/rpc-exception.filter";
import { EXCHANGE } from "@app/common/constants/exchange";
import { QUEUES } from "@app/common/constants/queues";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(InventoryModule);

  const rmqService = app.get<RmqService>(RmqService);
  app.connectMicroservice(
    rmqService.getOptionsTopic("INVENTORY_SERVICE", false, {
      name: EXCHANGE.ORDERS_EXCHANGE,
      type: "fanout",
    }),
  );
  app.connectMicroservice(
    rmqService.getOptionsTopic(QUEUES.INVENTORY_PRODUCT_SERVICE, false, {
      name: EXCHANGE.PRODUCT_EXCHANGE,
      type: "fanout",
    }),
  );

  // Add TCP microservice for direct communication
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: TCP_HOST,
      port: PORT_TCP.INVENTORY_TCP_PORT,
    },
  });

  // Enable global RPC exception filter for microservices
  app.useGlobalFilters(new AllRpcExceptionFilter());

  // Start all microservices (RMQ + TCP). No HTTP listener: inventory is
  // TCP/RMQ-only, and app.listen on the same port caused EADDRINUSE on Linux.
  await app.startAllMicroservices();
  await app.init();

  console.log("✅ Inventory service is running:");
  console.log(
    `   🔌 TCP Microservice: localhost:${PORT_TCP.INVENTORY_TCP_PORT}`,
  );
  console.log("   📨 RabbitMQ Consumer: INVENTORY_SERVICE_QUEUE");
}
void bootstrap();
