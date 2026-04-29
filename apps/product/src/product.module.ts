import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { Product } from './entity/product.entity';
import { Brand } from './entity/brand.entity';
import { Category } from './entity/category.entity';
import { DatabaseModule } from '@app/database';

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([Product, Brand, Category])
  ],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService]
})
export class ProductModule {}