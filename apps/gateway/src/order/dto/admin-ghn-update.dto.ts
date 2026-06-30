import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

// Canonical GHN status values the shipping console may simulate via the
// demo-only endpoint. Mirrors the GhnStatus enum the FE already uses.
export const DEMO_GHN_STATUSES = [
  "ready_to_pick",
  "picking",
  "delivering",
  "delivered",
  "delivery_fail",
  "waiting_to_return",
  "returned",
  "cancelled",
] as const;

export class UpdateGhnCodDto {
  @ApiProperty({
    description: "New COD amount in VND (0 to clear COD)",
    minimum: 0,
    example: 250000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  declare codAmount: number;
}

export class UpdateGhnReceiverDto {
  @ApiPropertyOptional({ description: "New receiver full name" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  declare toName?: string;

  @ApiPropertyOptional({ description: "New receiver phone number" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  declare toPhone?: string;

  @ApiPropertyOptional({ description: "New receiver street address" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare toAddress?: string;
}

export class SetGhnDemoStatusDto {
  @ApiProperty({
    description: "GHN status to simulate (demo only — does not call real GHN)",
    enum: DEMO_GHN_STATUSES,
    example: "delivering",
  })
  @IsIn(DEMO_GHN_STATUSES)
  declare ghnStatus: (typeof DEMO_GHN_STATUSES)[number];
}
