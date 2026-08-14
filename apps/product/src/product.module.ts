import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { ProductService } from "./product.service";
import { ProductController } from "./product.controller";
import { ProductImageHashService } from "./product-image-hash.service";
import { Product } from "./entity/product.entity";
import { ProductReview } from "./entity/product-review.entity";
import { ProductSku } from "./entity/product-sku.entity";
import { WishlistItem } from "./entity/wishlist-item.entity";
import { Brand } from "./entity/brand.entity";
import { Category } from "./entity/category.entity";
import { ProductRiskFeedback } from "./entity/product-risk-feedback.entity";
import { DatabaseModule } from "@app/database";
import {
  CloudinaryModule,
  ResilientClientTCP,
  RmqModule,
  RmqService,
} from "@app/common";
import { CachedModule } from "@app/cached";
import { ClientsModule } from "@nestjs/microservices";
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
    ScheduleModule.forRoot(),
    DatabaseModule,
    TypeOrmModule.forFeature([
      Product,
      ProductReview,
      ProductSku,
      WishlistItem,
      Brand,
      Category,
      ProductRiskFeedback,
    ]),
    ClientsModule.register([
      {
        name: NAME_SERVICE_TCP.ORDERS_SERVICE,
        customClass: ResilientClientTCP,
        options: {
          host: TCP_HOST,
          port: PORT_TCP.ORDERS_TCP_PORT,
        },
      },
    ]),
    RmqModule,
    RmqModule.registerDirectPublisher(),
    CachedModule,
    CloudinaryModule,
  ],
  controllers: [ProductController],
  providers: [ProductService, ProductImageHashService, RmqService],
  exports: [ProductService],
})
export class ProductModule {}
