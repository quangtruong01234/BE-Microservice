import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from "class-validator";

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: "Start of the window (ISO date). Defaults to 30 days ago.",
    example: "2026-06-01",
  })
  @IsOptional()
  @IsDateString()
  declare from?: string;

  @ApiPropertyOptional({
    description: "End of the window (ISO date, inclusive). Defaults to now.",
    example: "2026-07-01",
  })
  @IsOptional()
  @IsDateString()
  declare to?: string;

  @ApiPropertyOptional({
    description: "Period granularity for the revenue series.",
    enum: ["day", "month"],
    default: "day",
  })
  @IsOptional()
  @IsIn(["day", "month"])
  declare interval?: "day" | "month";

  @ApiPropertyOptional({
    description: "Number of top products to return.",
    default: 5,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  declare topN?: number;
}
