import { NestFactory } from "@nestjs/core";
import { RmqService } from "@app/common";
import { RewardsModule } from "./rewards.module";
import { ValidationPipe } from "@nestjs/common";
import { EXCHANGE } from "@app/common/constants/exchange";
import { AllRpcExceptionFilter } from "./filters/rpc-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(RewardsModule, {
    logger: ["log", "error", "warn", "debug", "verbose"],
  });

  // Enable global RPC exception filter for microservices
  app.useGlobalFilters(new AllRpcExceptionFilter());

  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false, // Allow extra properties for microservice flexibility
    }),
  );

  const rmqService = app.get<RmqService>(RmqService);
  app.connectMicroservice(
    rmqService.getOptionsTopic("REWARDS_SERVICE", false, {
      name: EXCHANGE.ORDERS_EXCHANGE,
      type: "fanout",
    }),
  );
  await app.startAllMicroservices();
  console.log("🎁 Rewards microservice is running and listening for events.");
}
void bootstrap();
