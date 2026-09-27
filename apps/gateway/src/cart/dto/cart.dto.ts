import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { IsPublicId } from "../../common/validators/is-public-id.validator";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";
import { MAX_CART_LINE_QUANTITY } from "libs/constant/cart.constant";

export class AddToCartDto {
  @ApiProperty({ example: "prod_8fK2mQ9xL3pT7vWb" })
  @IsString()
  @IsPublicId(PUBLIC_ID_PREFIXES.PRODUCT)
  declare productId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  skuId?: number;

  @ApiProperty({ minimum: 1, maximum: MAX_CART_LINE_QUANTITY })
  @IsInt()
  @Min(1)
  @Max(MAX_CART_LINE_QUANTITY)
  declare quantity: number;
}

export class UpdateCartItemDto {
  @ApiProperty({ minimum: 0, maximum: MAX_CART_LINE_QUANTITY })
  @IsInt()
  @Min(0)
  @Max(MAX_CART_LINE_QUANTITY)
  declare quantity: number;
}
