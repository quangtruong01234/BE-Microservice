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

  @ApiProperty({ type: [ShippingFeeItemDto], description: "Items to ship" })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShippingFeeItemDto)
  declare items: ShippingFeeItemDto[];
}
