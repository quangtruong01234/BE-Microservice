import { PartialType } from "@nestjs/swagger";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from "class-validator";
import { IsPublicId } from "../../common/validators/is-public-id.validator";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";

export class ProductResponseDto {
  @ApiProperty({
    type: [String],
    description: "IDs of categories this product belongs to",
  })
  @IsArray()
  @IsNumber({}, { each: true })
  declare categoryIds: number[];
}

export class GetProductsWithInventoryDto {
  @ApiProperty({
    type: [String],
    description: "Product IDs to fetch (max 50)",
    example: ["prod_8fK2mQ9xL3pT7vWb"],
    maxItems: 50,
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsPublicId(PUBLIC_ID_PREFIXES.PRODUCT, { each: true })
  declare productIds: string[];
}

export class CreateSkuGatewayDto {
  @ApiProperty({
    description: 'Tier index as JSON array string, e.g. "[0,1]"',
    example: "[0,1]",
  })
  @IsString()
  @Matches(/^\[\d+(,\d+)*\]$/, {
    message: 'tierIdx must be a JSON array of integers, e.g. "[0,1]"',
  })
  declare tierIdx: string;

  @ApiProperty({ description: "SKU price", example: 99000, minimum: 0 })
  @IsNumber()
  @Min(0)
  declare price: number;

  @ApiPropertyOptional({
    description: "Stock quantity",
    example: 10,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({ description: "SKU code", example: "SKU-RED-M" })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ description: "Whether this SKU is active" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSkuGatewayDto extends PartialType(CreateSkuGatewayDto) {}
