import { forwardRef, Module } from "@nestjs/common";
import { CartController } from "./cart.controller";
import { CartGatewayService } from "./cart.service";
import { GatewayModule } from "../gateway.module";

@Module({
  imports: [forwardRef(() => GatewayModule)],
  controllers: [CartController],
  providers: [CartGatewayService],
})
export class CartModule {}
