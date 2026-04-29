import { forwardRef, Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { CachedModule } from '@app/cached';
import { GatewayModule } from '../gateway.module';

@Module({
  imports: [forwardRef(() => GatewayModule), CachedModule],
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
