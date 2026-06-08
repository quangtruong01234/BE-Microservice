import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  ArrayMinSize,
  IsInt,
  Min,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

class SkuItemDto {
  @ApiProperty({ description: 'Tier index e.g. "[0,0]"', example: "[0,0]" })
  @IsString()
  @Matches(/^\[\d+(,\d+)*\]$/, {
    message: 'tierIdx must be a JSON array string e.g. "[0,0]"',
  })
  declare tierIdx: string;

  @ApiProperty({ description: "SKU price", example: 999 })
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  declare price: number;

  @ApiPropertyOptional({ description: "Stock quantity", example: 50 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({ description: "SKU code", example: "IPH14-RED-128" })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ description: "Is this SKU active", example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class VariationItemDto {
  @ApiProperty({ description: "Variation axis name", example: "Color" })
  @IsString()
  declare name: string;

  @ApiProperty({
    description: "Variation options",
    example: ["Red", "Blue"],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  declare options: string[];
}

export class CreateProductDto {
  @ApiProperty({
    description: "Product name",
    example: "iPhone 14 Pro Max",
  })
  @IsString()
  declare name: string;

  @ApiPropertyOptional({
    description: "Product description",
    example: "Latest iPhone with A16 Bionic chip",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      "Product price — omit when using variations/skuList (price lives on each SKU)",
    example: 1299.99,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  price?: number;

  @ApiPropertyOptional({
    description: "Initial stock quantity — omit when using skuList",
    example: 100,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({
    description:
      "Product SKU — omit when using skuList (sku is on each ProductSku row)",
    example: "IPH14PM-256-BLK",
  })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({
    description: "Brand ID",
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  brandId?: number;

  @ApiProperty({
    description: "Category IDs",
    example: [1, 2],
    type: [Number],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  declare categoryIds: number[];

  @ApiPropertyOptional({
    description: "Product active status",
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: "Product condition",
    example: "new",
    enum: ["new", "used", "refurbished"],
    default: "new",
  })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({
    description: "Seller notes",
  })
  @IsOptional()
  @IsString()
  sellerNotes?: string;

  @ApiPropertyOptional({
    description: "Product weight in grams",
    example: 500,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  weight?: number;

  @ApiPropertyOptional({
    description:
      "Variation axes — provide together with skuList for SKU matrix products",
    example: [
      { name: "Color", options: ["Red", "Blue"] },
      { name: "Size", options: ["128GB", "256GB"] },
    ],
    type: [VariationItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariationItemDto)
  variations?: VariationItemDto[];

  @ApiPropertyOptional({
    description: "SKU combinations — one entry per variation combination",
    example: [
      { tierIdx: "[0,0]", price: 999, stockQuantity: 50 },
      { tierIdx: "[0,1]", price: 1099, stockQuantity: 30 },
      { tierIdx: "[1,0]", price: 949, stockQuantity: 60 },
      { tierIdx: "[1,1]", price: 1049, stockQuantity: 40 },
    ],
    type: [SkuItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkuItemDto)
  skuList?: SkuItemDto[];
}
