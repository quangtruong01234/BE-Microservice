import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
  IsIn,
  IsArray,
  ArrayMinSize,
  IsInt,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { CreateProductSkuDto } from "./create-product-sku.dto";

class VariationItemDto {
  @IsString()
  declare name: string;

  @IsArray()
  @IsString({ each: true })
  declare options: string[];
}

export class CreateProductDto {
  @IsString()
  declare name: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Optional for SKU products (price lives on individual SKUs)
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  stockQuantity?: number;

  // Optional for SKU products (sku is on each ProductSku row)
  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  brandId?: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  declare categoryIds: number[];

  @IsNumber()
  declare userId: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(["new", "used", "refurbished"])
  condition?: string;

  @IsOptional()
  @IsString()
  sellerNotes?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  weight?: number;

  // Variation axes — required when skuList is provided
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariationItemDto)
  variations?: VariationItemDto[];

  // SKU combinations — required when variations is provided
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductSkuDto)
  skuList?: CreateProductSkuDto[];
}
