import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  Matches,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { PartialType, OmitType } from "@nestjs/mapped-types";

export class CreateProductSkuDto {
  @IsString()
  @Matches(/^\[\d+(,\d+)*\]$/, {
    message: 'tierIdx must be a JSON array string e.g. "[0,0]" or "[1]"',
  })
  declare tierIdx: string;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  declare price: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  stockQuantity?: number;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductSkuDto extends PartialType(
  OmitType(CreateProductSkuDto, ["tierIdx"] as const),
) {}
