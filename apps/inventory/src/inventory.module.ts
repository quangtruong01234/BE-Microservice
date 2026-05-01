import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Inventory } from "./inventory.entity";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { PostgresDatabaseModule } from "@app/database";
import { RmqService } from "@app/common";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeB/.env",
    }),
    // TypeOrmModule.forRoot({
    //   type: 'postgres',
    //   host: process.env.PG_HOST || 'localhost',
    //   port: parseInt(process.env.PG_PORT ? process.env.PG_PORT : '5432', 10),
    //   username: process.env.PG_USERNAME || 'postgres',
    //   password: process.env.PG_PASSWORD || 'postgres',
    //   database: process.env.PG_DATABASE || 'inventory',
    //   ssl: { rejectUnauthorized: false },
    //   entities: [Inventory],
    //   synchronize: true, // Chỉ dùng cho dev, không nên dùng production
    // }),
    TypeOrmModule.forRoot({
      type: "mysql",
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT),
      username: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      entities: [Inventory],
      synchronize: true,
    }),
    // PostgresDatabaseModule,
    TypeOrmModule.forFeature([Inventory]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService, RmqService],
})
export class InventoryModule {}
