import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsEnum,
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
import { PaymentMethod } from "@app/common";

export class OrderItemDto {
  @ApiProperty({ description: "Product ID", example: 1 })
  @IsInt()
  declare productId: number;

  @ApiPropertyOptional({
    description: "SKU ID for variation products — omit for base-price products",
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  skuId?: number;

  @ApiProperty({ description: "Product name", example: "iPhone 15 Pro" })
  @IsString()
  declare productName: string;

  @ApiProperty({ description: "Quantity", example: 2 })
  @IsInt()
  @Min(1)
  declare quantity: number;

  // price intentionally omitted — server fetches authoritative price from product service

  @ApiPropertyOptional({ description: "Khối lượng item (gram)", example: 300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;
}

export class CreateOrderDto {
  @ApiProperty({
    enum: PaymentMethod,
    description: "Payment method",
    example: "zalopay",
  })
  @IsEnum(PaymentMethod)
  @IsNotEmpty()
  declare paymentMethod: PaymentMethod;

  @ApiProperty({
    description: "Full shipping address",
    example: "123 Nguyen Hue, District 1, Ho Chi Minh City",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  declare shippingAddress: string;

  @ApiProperty({ type: [OrderItemDto], description: "List of order items" })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  declare items: OrderItemDto[];
}
