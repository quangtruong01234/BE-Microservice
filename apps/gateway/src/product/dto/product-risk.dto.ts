import { Transform, Type } from "class-transformer";
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

  @ApiPropertyOptional({
    description:
      "Search — case-insensitive substring match on the product name (the seller is not searched). Blank means no filter; ANDs with minScore, and total/totalPages/hasNext describe the searched set.",
    example: "tai nghe",
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  q?: string;
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
