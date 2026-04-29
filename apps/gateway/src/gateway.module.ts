import { Module } from "@nestjs/common";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { GatewayController } from "./gateway.controller";
import { GatewayService } from "./gateway.service";
import { TCP } from "@app/common/constants/TCP";
import { InventoryModule } from "./inventory/inventory.module";
import { UserModule } from "./user/user.module";
import { OrderModule } from "./order/order.module";
import { ProductModule } from "./product/product.module";
import { CachedModule } from "@app/cached";
import { NAME_SERVICE_TCP, PORT_TCP } from "libs/constant/port-tcp.constant";

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.ORDERS_SERVICE, // Tên token để inject
        transport: Transport.TCP,
        options: {
          host: "localhost", // Hoặc địa chỉ IP của Orders service
          port: PORT_TCP.ORDERS_TCP_PORT, // Port mà Orders service sẽ lắng nghe
        },
      },
      {
        name: NAME_SERVICE_TCP.INVENTORY_SERVICE,
        transport: Transport.TCP,
        options: {
          host: "localhost",
          port: PORT_TCP.INVENTORY_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.USER_SERVICE,
        transport: Transport.TCP,
        options: {
          host: "localhost",
          port: PORT_TCP.USER_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.PRODUCT_SERVICE,
        transport: Transport.TCP,
        options: {
          host: "localhost",
          port: PORT_TCP.PRODUCT_TCP_PORT,
        },
      },
    ]),
    InventoryModule,
    UserModule,
    OrderModule,
    ProductModule,
    CachedModule,
  ],
  controllers: [GatewayController],
  providers: [GatewayService],
  exports: [ClientsModule],
})
export class GatewayModule {}
