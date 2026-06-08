import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNumber, IsOptional, Min } from "class-validator";

export class AddToCartDto {
  @ApiProperty()
  @IsNumber()
  declare productId: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  skuId?: number;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  declare quantity: number;
}

export class UpdateCartItemDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  declare quantity: number;
}
