import { Module } from "@nestjs/common";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";

@Module({
  imports: [
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.INVENTORY_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.INVENTORY_TCP_PORT,
        },
      },
      {
        name: NAME_SERVICE_TCP.PRODUCT_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.PRODUCT_TCP_PORT,
        },
      },
    ]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
