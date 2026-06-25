import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProductService } from "./product.service";
import { ProductController } from "./product.controller";
import { Product } from "./entity/product.entity";
import { ProductReview } from "./entity/product-review.entity";
import { ProductSku } from "./entity/product-sku.entity";
import { Brand } from "./entity/brand.entity";
import { Category } from "./entity/category.entity";
import { DatabaseModule } from "@app/database";
import { RmqModule, RmqService } from "@app/common";
import { CachedModule } from "@app/cached";
import { ClientsModule, Transport } from "@nestjs/microservices";
import {
  NAME_SERVICE_TCP,
  PORT_TCP,
  TCP_HOST,
} from "libs/constant/port-tcp.constant";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeA/.env",
    }),
    DatabaseModule,
    TypeOrmModule.forFeature([
      Product,
      ProductReview,
      ProductSku,
      Brand,
      Category,
    ]),
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.ORDERS_SERVICE,
        transport: Transport.TCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.ORDERS_TCP_PORT,
        },
      },
    ]),
    RmqModule,
    RmqModule.registerDirectPublisher(),
    CachedModule,
  ],
  controllers: [ProductController],
  providers: [ProductService, RmqService],
  exports: [ProductService],
})
export class ProductModule {}
