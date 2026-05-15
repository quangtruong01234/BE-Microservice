import { NestFactory } from "@nestjs/core";
import { UserModule } from "./user.module";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import * as dotenv from "dotenv";
import { PORT_TCP } from "libs/constant/port-tcp.constant";
import { AllRpcExceptionFilter } from "./filters/rpc-exception.filter";

async function bootstrap() {
  dotenv.config();
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    UserModule,
    {
      transport: Transport.TCP,
      options: {
        host: "localhost",
        port: PORT_TCP.USER_TCP_PORT, // Port phải khớp với cấu hình ở GatewayModule
      },
    },
  );

  // Enable global RPC exception filter
  app.useGlobalFilters(new AllRpcExceptionFilter());

  // Enable validation (disabled temporarily to debug)
  // app.useGlobalPipes(new ValidationPipe({
  //   transform: true,
  //   whitelist: true,
  //   forbidNonWhitelisted: false, // Allow extra properties for microservice flexibility
  // }));

  await app.listen();
  console.log(
    `User microservice is listening on port ${PORT_TCP.USER_TCP_PORT}`,
  );
}
void bootstrap();
