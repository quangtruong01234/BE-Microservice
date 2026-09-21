import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsOptional } from "class-validator";
import { ORDER_STATUS_VALUES } from "libs/constant/order-status.constant";

/**
 * EXPORT-CSV-01. Both bounds are REQUIRED here, unlike `AnalyticsQueryDto`
 * which defaults to the last 30 days: an export that silently defaults its
 * window is how someone downloads a year by accident and then reports the
 * endpoint as broken. The orders service enforces the 90-day / 5.000-row caps.
 */
export class ExportSellerOrdersQueryDto {
  @ApiProperty({
    description: "Start of the export window (ISO date, inclusive).",
    example: "2026-06-01",
  })
  @IsDateString()
  declare from: string;

  @ApiProperty({
    // Exactly 90 days from the `from` example — the cap is inclusive on both
    // ends, so a Swagger "Try it out" on a wider pair would 400 on the very
    // example that documents the endpoint. 2026-08-30 was one day too far.
    description: "End of the export window (ISO date, inclusive).",
    example: "2026-08-29",
  })
  @IsDateString()
  declare to: string;

  @ApiPropertyOptional({
    description: "Restrict the export to a single order status.",
    enum: ORDER_STATUS_VALUES,
  })
  @IsOptional()
  @IsIn(ORDER_STATUS_VALUES)
  declare status?: string;
}
