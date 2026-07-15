import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Min } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PriceSuggestionQueryDto {
  @ApiProperty({ description: "Category ID", example: 18, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare categoryId: number;

  @ApiPropertyOptional({ description: "Brand ID", example: 4, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare brandId?: number;

  @ApiPropertyOptional({
    description: "Product condition",
    enum: ["new", "used", "refurbished"],
  })
  @IsOptional()
  @IsIn(["new", "used", "refurbished"])
  declare condition?: "new" | "used" | "refurbished";
}
