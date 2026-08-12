import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { ORDER_STATUS_VALUES } from "libs/constant/order-status.constant";
import { GHN_STATUS_VALUES } from "libs/constant/shipping.constant";

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

  // Both filters used to be bare @IsString(), so a typo ("shiped", "delivered"
  // as a LOCAL status) passed validation and filtered the query down to zero
  // rows — a 200 with an empty list reads as "no such orders" rather than "you
  // asked for something that does not exist". @IsIn turns it into a 400 that
  // names the accepted values.
  @ApiPropertyOptional({
    description: "Local order status filter",
    enum: ORDER_STATUS_VALUES,
  })
  @IsOptional()
  @IsIn(ORDER_STATUS_VALUES)
  declare status?: string;

  @ApiPropertyOptional({
    description: "Latest or recorded GHN status filter",
    enum: GHN_STATUS_VALUES,
  })
  @IsOptional()
  @IsIn(GHN_STATUS_VALUES)
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
