import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Min, IsNotEmpty } from "class-validator";

export class CreateInventoryDto {
  @ApiProperty({
    description: "Product ID to create inventory for",
    example: 1,
    type: "integer",
  })
  @IsInt()
  @IsNotEmpty()
  productId: number;

  @ApiProperty({
    description: "Product SKU",
    example: "IPHONE15-BK-128",
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  sku: string;

  @ApiProperty({
    description: "Available stock quantity",
    example: 50,
    minimum: 0,
    type: "integer",
  })
  @IsInt()
  @Min(0)
  availableStock: number;

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
