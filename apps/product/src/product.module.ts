import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProductService } from "./product.service";
import { ProductController } from "./product.controller";
import { Product } from "./entity/product.entity";
import { Brand } from "./entity/brand.entity";
import { Category } from "./entity/category.entity";
import { DatabaseModule } from "@app/database";
import { RmqModule, RmqService } from "@app/common";
import { CachedModule } from "@app/cached";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "./local/nodeA/.env",
    }),
    DatabaseModule,
    TypeOrmModule.forFeature([Product, Brand, Category]),
    RmqModule,
    CachedModule,
  ],
  controllers: [ProductController],
  providers: [ProductService, RmqService],
  exports: [ProductService],
})
export class ProductModule {}
