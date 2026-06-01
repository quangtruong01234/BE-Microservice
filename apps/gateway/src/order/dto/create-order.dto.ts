import { ApiProperty } from "@nestjs/swagger";
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
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
  product_id!: number;

  @ApiProperty({ description: "Product name", example: "iPhone 15 Pro" })
  @IsString()
  product_name!: string;

  @ApiProperty({ description: "Quantity", example: 2 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: "Unit price at time of order", example: 99000 })
  @IsNumber()
  @Min(0)
  price!: number;
}

export class CreateOrderDto {
  @ApiProperty({
    enum: PaymentMethod,
    description: "Payment method",
    example: "zalopay",
  })
  @IsEnum(PaymentMethod)
  @IsNotEmpty()
  payment_method!: PaymentMethod;

  @ApiProperty({
    description: "Full shipping address",
    example: "123 Nguyen Hue, District 1, Ho Chi Minh City",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  shipping_address!: string;

  @ApiProperty({ type: [OrderItemDto], description: "List of order items" })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}
