import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, Min, IsNotEmpty, IsOptional } from "class-validator";

export class CheckStockDto {
  @ApiProperty({
    description: "Product ID to check stock",
    example: 1,
    type: "integer",
  })
  @IsInt()
  @IsNotEmpty()
  declare productId: number;

  @ApiPropertyOptional({
    description: "Product SKU ID when checking variant stock",
    example: 6,
    type: "integer",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  skuId?: number;

  @ApiProperty({
    description: "Quantity to check availability",
    example: 5,
    minimum: 1,
    type: "integer",
  })
  @IsInt()
  @Min(1)
  declare quantity: number;
}

export class ReserveStockDto {
  @ApiProperty({
    description: "Product ID to reserve stock",
    example: 1,
    type: "integer",
  })
  @IsInt()
  @IsNotEmpty()
  declare productId: number;

  @ApiPropertyOptional({
    description: "Product SKU ID when reserving variant stock",
    example: 6,
    type: "integer",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  skuId?: number;

  @ApiProperty({
    description: "Quantity to reserve",
    example: 3,
    minimum: 1,
    type: "integer",
  })
  @IsInt()
  @Min(1)
  declare quantity: number;
}

export class ReleaseStockDto {
  @ApiProperty({
    description: "Product ID to release stock",
    example: 1,
    type: "integer",
  })
  @IsInt()
  @IsNotEmpty()
  declare productId: number;

  @ApiPropertyOptional({
    description: "Product SKU ID when releasing variant stock",
    example: 6,
    type: "integer",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  skuId?: number;

  @ApiProperty({
    description: "Quantity to release",
    example: 2,
    minimum: 1,
    type: "integer",
  })
  @IsInt()
  @Min(1)
  declare quantity: number;
}
