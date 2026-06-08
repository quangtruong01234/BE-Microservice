import { PartialType } from "@nestjs/swagger";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from "class-validator";

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
