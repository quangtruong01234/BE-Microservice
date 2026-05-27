import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Inventory } from "./inventory.entity";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { PostgresDatabaseModule } from "@app/database";
import { RmqModule, RmqService } from "@app/common";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeB/.env",
    }),
    PostgresDatabaseModule,
    TypeOrmModule.forFeature([Inventory]),
    RmqModule,
    RmqModule.registerDirectPublisher(),
  ],
  controllers: [InventoryController],
  providers: [InventoryService, RmqService],
})
export class InventoryModule {}
