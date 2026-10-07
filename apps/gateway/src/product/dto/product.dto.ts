import { PartialType } from "@nestjs/swagger";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import {
  ABSTAIN_REASONS,
  AbstainReason,
  RAG_CHUNK_SOURCES,
  RagChunkSource,
} from "@app/common";
import { IsPublicId } from "../../common/validators/is-public-id.validator";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";

export class ProductResponseDto {
  @ApiProperty({
    type: [String],
    description: "IDs of categories this product belongs to",
  })
  @IsArray()
  @IsNumber({}, { each: true })
  declare categoryIds: number[];
}

export class GetProductsWithInventoryDto {
  @ApiProperty({
    type: [String],
    description: "Product IDs to fetch (max 50)",
    example: ["prod_8fK2mQ9xL3pT7vWb"],
    maxItems: 50,
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsPublicId(PUBLIC_ID_PREFIXES.PRODUCT, { each: true })
  declare productIds: string[];
}

export class CreateSkuGatewayDto {
  @ApiProperty({
    description: 'Tier index as JSON array string, e.g. "[0,1]"',
    example: "[0,1]",
  })
  @IsString()
  @Matches(/^\[\d+(,\d+)*\]$/, {
    message: 'tierIdx must be a JSON array of integers, e.g. "[0,1]"',
  })
  declare tierIdx: string;

  @ApiProperty({ description: "SKU price", example: 99000, minimum: 0 })
  @IsNumber()
  @Min(0)
  declare price: number;

  @ApiPropertyOptional({
    description: "Stock quantity",
    example: 10,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({ description: "SKU code", example: "SKU-RED-M" })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ description: "Whether this SKU is active" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSkuGatewayDto extends PartialType(CreateSkuGatewayDto) {}

/** RAIL-RANK-01 — query for the storefront "Đang hot" rail. */
export class TrendingProductsQueryDto {
  @ApiPropertyOptional({
    description: "Max products to return",
    default: 5,
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  limit?: number = 5;
}

// ============================================================================
// PRODUCT-QA-01 — grounded product Q&A (ai-docs/specs/PRODUCT-QA-01/contract.md)
// ============================================================================

export class AskProductQuestionDto {
  @ApiProperty({
    example: "Có vừa laptop 15 inch không?",
    minLength: 3,
    maxLength: 300,
    description: "Free-text question, 3..300 characters after trim",
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @Length(3, 300)
  declare question: string;
}

export class ProductAnswerCitationDto {
  @ApiProperty({ example: 1, description: "1-based [n] marker in answer" })
  declare index: number;

  @ApiProperty({ enum: RAG_CHUNK_SOURCES, example: "PRODUCT" })
  declare source: RagChunkSource;

  @ApiProperty({
    example: "Ngăn chính chống sốc, vừa laptop tới 15.6 inch.",
    description: "Verbatim excerpt of the indexed text, at most 300 chars",
  })
  declare snippet: string;
}

export class ProductAnswerDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: "Có, ngăn chính vừa laptop tới 15.6 inch [1].",
    description: "null exactly when abstained is true",
  })
  declare answer: string | null;

  @ApiProperty({ example: false })
  declare abstained: boolean;

  @ApiProperty({
    enum: ABSTAIN_REASONS,
    nullable: true,
    example: null,
    description: "null exactly when abstained is false",
  })
  declare abstainReason: AbstainReason | null;

  @ApiProperty({
    type: [ProductAnswerCitationDto],
    description: "Always an array; [] when abstained",
  })
  declare citations: ProductAnswerCitationDto[];
}
