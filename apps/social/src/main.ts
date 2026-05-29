import { NestFactory } from "@nestjs/core";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import * as dotenv from "dotenv";
import { PORT_TCP, TCP_HOST } from "libs/constant/port-tcp.constant";
import { SocialModule } from "./social.module";

async function bootstrap() {
  dotenv.config({ path: "./local/nodeA/.env" });

  const app = await NestFactory.create(SocialModule);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      host: TCP_HOST,
      port: PORT_TCP.SOCIAL_TCP_PORT,
    },
  });

  await app.startAllMicroservices();
  console.log(`Social service running: TCP :${PORT_TCP.SOCIAL_TCP_PORT}`);
}
void bootstrap();
