import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString, Min } from "class-validator";
import { IsPublicId } from "../../common/validators/is-public-id.validator";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";

export class AddToCartDto {
  @ApiProperty({ example: "prod_8fK2mQ9xL3pT7vWb" })
  @IsString()
  @IsPublicId(PUBLIC_ID_PREFIXES.PRODUCT)
  declare productId: string;

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
