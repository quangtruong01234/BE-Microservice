import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  ORDER_STATUS_VALUES,
  OrderStatusValue,
} from "libs/constant/order-status.constant";

/**
 * Accepts `?status=refunded`, `?status=refunded,return_requested` and repeated
 * `?status=a&status=b` — buyer tabs group several statuses under one label, so
 * the filter has to take a set. Bracket syntax (`status[]=`) is NOT supported
 * (Express' simple query parser), same as every other list param here.
 */
const toStatusList = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) {
    return value;
  }
  const raw: unknown[] = Array.isArray(value) ? (value as unknown[]) : [value];
  return raw
    .flatMap((entry): unknown[] =>
      typeof entry === "string" ? entry.split(",") : [entry],
    )
    .map((entry): unknown => (typeof entry === "string" ? entry.trim() : entry))
    .filter((entry) => entry !== "");
};

export class GetOrdersByUserQueryDto {
  @ApiPropertyOptional({ description: "Page number", default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: "Items per page",
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({
    description:
      "Filter by order status. Repeat the key or send a comma-separated list to combine statuses, e.g. `?status=return_requested&status=refunded`. Unknown values are rejected with 400.",
    enum: ORDER_STATUS_VALUES,
    isArray: true,
    example: ["return_requested", "refunded"],
  })
  @IsOptional()
  @Transform(toStatusList)
  @IsIn(ORDER_STATUS_VALUES, { each: true })
  status?: OrderStatusValue[];

  @ApiPropertyOptional({
    description:
      "Search by order code — case-insensitive substring match on the order public id. The `ord_` prefix is optional (`516a` and `ord_516a` both match `ord_516a...`). Combined with `status` it ANDs, and `total`/`totalPages`/`hasNext` describe the searched set.",
    example: "516a",
    maxLength: 32,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(32)
  q?: string;
}
