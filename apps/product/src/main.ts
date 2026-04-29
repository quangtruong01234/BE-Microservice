import { NestFactory } from '@nestjs/core';
import { ProductModule } from './product.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { PORT_TCP } from 'libs/constant/port-tcp.constant';
import { AllRpcExceptionFilter } from './filters/rpc-exception.filter';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    ProductModule,
    {
      transport: Transport.TCP,
      options: {
        host: 'localhost',
        port: PORT_TCP.PRODUCT_TCP_PORT, // Port phải khớp với cấu hình ở Gateway
      },
    }
  );

  // Enable global RPC exception filter
  app.useGlobalFilters(new AllRpcExceptionFilter());

  await app.listen();
  console.log(`Product microservice is listening on port ${PORT_TCP.PRODUCT_TCP_PORT}`);
}
bootstrap();