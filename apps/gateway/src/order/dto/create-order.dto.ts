import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsInt, IsNumber, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class OrderItemDto {
  @ApiProperty({ description: "Product ID", example: 1 })
  @IsInt()
  product_id!: number;

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
  @ApiProperty({ type: [OrderItemDto], description: "List of order items" })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}
