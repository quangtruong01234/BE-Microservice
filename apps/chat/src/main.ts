import { NestFactory } from "@nestjs/core";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import * as dotenv from "dotenv";
import { PORT_TCP } from "libs/constant/port-tcp.constant";
import { ChatModule } from "./chat.module";

async function bootstrap() {
  dotenv.config({ path: "./local/nodeA/.env" });

  const app = await NestFactory.create(ChatModule);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: "0.0.0.0",
      port: PORT_TCP.CHAT_SERVICE_PORT,
    },
  });

  await app.startAllMicroservices();
  await app.init();
  console.log(`Chat service running: TCP :${PORT_TCP.CHAT_SERVICE_PORT}`);
}
void bootstrap();
