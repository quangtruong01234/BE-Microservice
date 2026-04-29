import { Module } from "@nestjs/common";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { ProductController } from "./product.controller";
import { ProductService } from "./product.service";
import { NAME_SERVICE_TCP, PORT_TCP } from "libs/constant/port-tcp.constant";

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.PRODUCT_SERVICE,
        transport: Transport.TCP,
        options: {
          host: "localhost",
          port: PORT_TCP.PRODUCT_TCP_PORT,
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
    ]),
  ],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
