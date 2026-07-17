import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ProductRiskQueryDto {
  @ApiPropertyOptional({
    description: "Minimum advisory risk score",
    minimum: 0,
    maximum: 100,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number = 1;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ProductRiskBackfillDto {
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cursor?: number = 0;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class ProductDuplicateImageCheckDto {
  @ApiProperty({
    description: "An already-uploaded Cloudinary URL owned by the seller",
  })
  @IsUrl({ require_protocol: true })
  declare imageUrl: string;
}

export class ProductRiskFeedbackDto {
  @ApiProperty({ enum: ["confirmed_duplicate", "dismissed"] })
  @IsIn(["confirmed_duplicate", "dismissed"])
  declare decision: "confirmed_duplicate" | "dismissed";

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
