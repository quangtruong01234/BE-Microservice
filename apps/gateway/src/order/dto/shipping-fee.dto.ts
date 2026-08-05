import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class ShippingFeeItemDto {
  @ApiPropertyOptional({
    description: "Product name (shown on the GHN preview)",
    example: "iPhone 15 Pro",
  })
  @IsOptional()
  @IsString()
  productName?: string;

  @ApiProperty({ description: "Quantity", example: 2 })
  @IsInt()
  @Min(1)
  declare quantity: number;

  @ApiPropertyOptional({ description: "Unit price (VND)", example: 250000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: "Item weight (gram)", example: 300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;
}

export class ShippingFeeDto {
  @ApiProperty({
    description:
      'Shipping address, pipe-delimited for GHN: "name|phone|addr|ward|district|province"',
    example:
      "Nguyen Van A|0987654321|123 Nguyen Hue|Phuong Ben Nghe|Quan 1|Ho Chi Minh",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  declare shippingAddress: string;

  @ApiPropertyOptional({
    description:
      "GHN DistrictID for the delivery address. Send together with toWardCode " +
      "so the fee preview uses the exact GHN location instead of resolving the " +
      "free-text address. Omit both for legacy free-text resolution.",
    example: 1450,
  })
  @IsOptional()
  // The global pipe transforms but does not enable implicit conversion, so a
  // JSON string id from the FE dropdown would fail @IsInt() without this.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  toDistrictId?: number;

  @ApiPropertyOptional({
    description:
      "GHN WardCode for the delivery address. Send together with toDistrictId.",
    example: "21211",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  toWardCode?: string;

  @ApiProperty({ type: [ShippingFeeItemDto], description: "Items to ship" })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShippingFeeItemDto)
  declare items: ShippingFeeItemDto[];
}
