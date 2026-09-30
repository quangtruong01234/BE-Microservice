import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateReturnRequestDto {
  @ApiProperty({
    description: "Reason the buyer is requesting a return/refund",
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  declare reason: string;
}

export class RejectReturnRequestDto {
  @ApiProperty({
    description: "Reason the seller/admin is rejecting the return request",
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  declare reason: string;
}

export class ReturnRequestsQueryDto {
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

  @ApiPropertyOptional({
    enum: ["pending_review", "approved", "rejected"],
    description: "Filter by request status (seller/admin list only)",
  })
  @IsOptional()
  @IsIn(["pending_review", "approved", "rejected"])
  declare status?: string;

  @ApiPropertyOptional({
    description:
      "Search — case-insensitive substring match on the return request code (rr_…) or the order code (ord_…). Blank means no filter; ANDs with status, and total/totalPages/hasNext describe the searched set.",
    example: "ord_516a",
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  declare q?: string;
}
