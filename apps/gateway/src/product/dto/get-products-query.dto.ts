import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  Min,
} from "class-validator";
import { Type, Transform } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsPublicId } from "../../common/validators/is-public-id.validator";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";

export class GetProductsQueryDto {
  @ApiPropertyOptional({
    description: "Page number for pagination",
    example: 1,
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: "Number of items per page",
    example: 10,
    default: 10,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: "Search keyword",
    example: "iPhone",
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: "Filter by category IDs (multi-select)",
    example: [1, 2],
    type: [Number],
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null
      ? value
      : (Array.isArray(value) ? value : [value]).map(Number),
  )
  @IsArray()
  @IsNumber({}, { each: true })
  categoryIds?: number[];

  @ApiPropertyOptional({
    description: "Filter by brand IDs (multi-select)",
    example: [1, 2],
    type: [Number],
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null
      ? value
      : (Array.isArray(value) ? value : [value]).map(Number),
  )
  @IsArray()
  @IsNumber({}, { each: true })
  brandIds?: number[];

  @ApiPropertyOptional({
    description: "Minimum price filter",
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minPrice?: number;

  @ApiPropertyOptional({
    description: "Maximum price filter",
    example: 2000,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  maxPrice?: number;

  @ApiPropertyOptional({
    description: "Filter by active status",
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === "true")
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: "Sort by field",
    example: "createdAt",
    default: "createdAt",
  })
  @IsOptional()
  @IsString()
  sortBy?: string = "createdAt";

  @ApiPropertyOptional({
    description: "Sort order",
    example: "DESC",
    enum: ["ASC", "DESC"],
    default: "DESC",
  })
  @IsOptional()
  @IsString()
  sortOrder?: "ASC" | "DESC" = "DESC";

  @ApiPropertyOptional({
    description: "Filter by featured status",
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === "true")
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({
    description: "Filter by trending status",
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === "true")
  @IsBoolean()
  isTrending?: boolean;

  @ApiPropertyOptional({
    description: "Filter by product condition",
    example: "new",
    enum: ["new", "used", "refurbished"],
  })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({
    description: "Minimum rating filter",
    example: 4.0,
    minimum: 0,
    maximum: 5,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  minRating?: number;

  @ApiPropertyOptional({
    description: "Maximum rating filter",
    example: 5.0,
    minimum: 0,
    maximum: 5,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  maxRating?: number;

  @ApiPropertyOptional({
    description: "Filter by creator user public ID",
    example: "usr_8fK2mQ9xL3pT7vWb",
    type: String,
  })
  @IsOptional()
  @IsString()
  @IsPublicId(PUBLIC_ID_PREFIXES.USER)
  userId?: string;

  @ApiPropertyOptional({
    description: "Search by SKU value across product variants",
    example: "SKU-001",
  })
  @IsOptional()
  @IsString()
  skuSearch?: string;

  @ApiPropertyOptional({
    description:
      "Filter by seller province IDs (GHN ProvinceID of the seller's default address, multi-select)",
    example: [201],
    type: [Number],
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === null
      ? value
      : (Array.isArray(value) ? value : [value]).map(Number),
  )
  @IsArray()
  @IsNumber({}, { each: true })
  provinceId?: number[];
}
