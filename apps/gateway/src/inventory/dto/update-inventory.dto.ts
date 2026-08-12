import { ApiProperty } from "@nestjs/swagger";
import {
  IsOptional,
  IsInt,
  IsString,
  IsNotEmpty,
  MaxLength,
  Min,
  IsBoolean,
} from "class-validator";

export class UpdateInventoryDto {
  @ApiProperty({
    description:
      "Inventory SKU. Accepted so a client can send back the row it just read; must stay unique across inventory rows.",
    example: "IPHONE15-BK-128",
    maxLength: 100,
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sku?: string;

  @ApiProperty({
    description: "Available stock quantity",
    example: 75,
    minimum: 0,
    type: "integer",
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  availableStock?: number;

  @ApiProperty({
    description: "Reserved stock quantity",
    example: 5,
    minimum: 0,
    type: "integer",
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  reservedStock?: number;

  @ApiProperty({
    description: "Minimum stock threshold",
    example: 15,
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
    example: "WAREHOUSE-A1-UPDATED",
    maxLength: 50,
    required: false,
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({
    description: "Active status",
    example: true,
    type: "boolean",
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
