import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
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
}
