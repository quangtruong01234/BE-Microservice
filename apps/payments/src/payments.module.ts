import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PostgresModule, RmqModule } from '@app/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    PostgresModule,
    ConfigModule.forRoot({
      isGlobal: true,
      // Quan trọng: Chỉ định đúng đường dẫn tới file .env của nodeB
      envFilePath: './local/nodeB/.env', 
    }),
    // RmqModule, // Import module Rmq chung để có thể inject RmqService
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}