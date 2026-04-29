import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { forwardRef } from '@nestjs/common';
import { GatewayModule } from '../gateway.module';

@Module({
  imports: [forwardRef(() => GatewayModule)],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
