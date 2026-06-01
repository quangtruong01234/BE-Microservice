import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  IsIn,
  IsArray,
  ArrayMinSize,
  IsInt,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateProductDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  price: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  stockQuantity?: number = 0;

  @IsString()
  sku: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  brandId?: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  categoryIds: number[];

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  userId?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;

  // Social engagement metrics
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  likesCount?: number = 0;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  commentsCount?: number = 0;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  sharesCount?: number = 0;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  viewCount?: number = 0;

  // Product status for timeline/feed
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean = false;

  @IsOptional()
  @IsBoolean()
  isTrending?: boolean = false;

  // Product condition and seller info
  @IsOptional()
  @IsString()
  @IsIn(["new", "used", "refurbished"])
  condition?: string = "new";

  @IsOptional()
  @IsString()
  sellerNotes?: string;

  // Rating system
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(5)
  rating?: number = 0;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  ratingCount?: number = 0;
}
