import { NestFactory } from "@nestjs/core";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { RmqService } from "@app/common";
import { EXCHANGE } from "@app/common/constants/exchange";
import { QUEUES } from "@app/common/constants/queues";
import { PORT_TCP, TCP_HOST } from "libs/constant/port-tcp.constant";
import { AssistantModule } from "./assistant.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AssistantModule);

  const rmqService = app.get<RmqService>(RmqService);
  app.connectMicroservice(
    rmqService.getOptionsTopic(QUEUES.ASSISTANT_PRODUCT_SERVICE, false, {
      name: EXCHANGE.PRODUCT_EXCHANGE,
      type: "fanout",
    }),
  );

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: TCP_HOST,
      port: PORT_TCP.ASSISTANT_TCP_PORT,
    },
  });

  // TCP/RMQ only — no HTTP listener.
  await app.startAllMicroservices();
  await app.init();

  console.log("✅ Assistant service is running:");
  console.log(
    `   🔌 TCP Microservice: localhost:${PORT_TCP.ASSISTANT_TCP_PORT}`,
  );
  console.log(`   📨 RabbitMQ Consumer: ${QUEUES.ASSISTANT_PRODUCT_SERVICE}`);
}
void bootstrap();
