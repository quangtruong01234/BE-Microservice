import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return undefined;
}

export class AdminGhnOrdersQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare limit?: number;

  @ApiPropertyOptional({ description: "Local order status filter" })
  @IsOptional()
  @IsString()
  declare status?: string;

  @ApiPropertyOptional({ description: "Latest or recorded GHN status filter" })
  @IsOptional()
  @IsString()
  declare ghnStatus?: string;

  @ApiPropertyOptional({
    description: "Filter orders with or without a GHN order code",
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  declare hasGhnCode?: boolean;

  @ApiPropertyOptional({
    description: "Search order id, GHN order code, or shipping address",
  })
  @IsOptional()
  @IsString()
  declare search?: string;

  @ApiPropertyOptional({ description: "Created-at start date (ISO 8601)" })
  @IsOptional()
  @IsDateString()
  declare dateFrom?: string;

  @ApiPropertyOptional({ description: "Created-at end date (ISO 8601)" })
  @IsOptional()
  @IsDateString()
  declare dateTo?: string;
}
