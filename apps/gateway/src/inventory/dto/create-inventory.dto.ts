import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Min, IsNotEmpty } from "class-validator";
import { IsPublicId } from "../../common/validators/is-public-id.validator";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";

export class CreateInventoryDto {
  @ApiProperty({
    description: "Product ID to create inventory for",
    example: "prod_8fK2mQ9xL3pT7vWb",
    type: "string",
  })
  @IsString()
  @IsNotEmpty()
  @IsPublicId(PUBLIC_ID_PREFIXES.PRODUCT)
  declare productId: string;

  @ApiPropertyOptional({
    description:
      "Product SKU ID — set when this inventory row tracks a specific SKU variant",
    example: 6,
    type: "integer",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  productSkuId?: number;

  @ApiProperty({
    description: "Product SKU",
    example: "IPHONE15-BK-128",
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  declare sku: string;

  @ApiProperty({
    description: "Available stock quantity",
    example: 50,
    minimum: 0,
    type: "integer",
  })
  @IsInt()
  @Min(0)
  declare availableStock: number;

  @ApiProperty({
    description: "Minimum stock threshold for low stock alerts",
    example: 10,
    minimum: 0,
    type: "integer",
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minimumStock?: number;

  @ApiProperty({
    description: "Warehouse location",
    example: "WAREHOUSE-A1",
    maxLength: 50,
    required: false,
  })
  @IsOptional()
  @IsString()
  location?: string;
}
