import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { OrderItemDto } from "./create-order.dto";

export enum VoucherDiscountType {
  PERCENT = "percent",
  FIXED = "fixed",
}

export class ValidateVoucherDto {
  @ApiProperty({ description: "Voucher / discount code", example: "SALE10" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  declare code: string;

  @ApiProperty({
    type: [OrderItemDto],
    description: "Basket items to price the voucher against",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  declare items: OrderItemDto[];
}

export class CreateVoucherDto {
  @ApiProperty({ description: "Unique voucher code", example: "SALE10" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  declare code: string;

  @ApiPropertyOptional({
    description: "Human-readable description",
    example: "10% off your order",
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiProperty({
    enum: VoucherDiscountType,
    description: "Discount type",
    example: "percent",
  })
  @IsEnum(VoucherDiscountType)
  declare discountType: VoucherDiscountType;

  @ApiProperty({
    description: "Discount value — percent (1-100) or fixed VND amount",
    example: 10,
  })
  @IsNumber()
  @Min(0)
  declare discountValue: number;

  @ApiPropertyOptional({
    description: "Minimum order subtotal (VND) required to use the voucher",
    example: 100000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @ApiPropertyOptional({
    description: "Cap on the discount for percent vouchers (VND)",
    example: 50000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number;

  @ApiPropertyOptional({
    description: "Total number of redemptions allowed across all users",
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @ApiPropertyOptional({
    description: "Number of redemptions allowed per user",
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  perUserLimit?: number;

  @ApiPropertyOptional({
    description: "ISO-8601 start of the validity window",
    example: "2026-07-01T00:00:00.000Z",
  })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({
    description: "ISO-8601 expiry of the validity window",
    example: "2026-08-01T00:00:00.000Z",
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @ApiPropertyOptional({
    description: "Whether the voucher is active on creation",
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class VouchersQueryDto {
  @ApiPropertyOptional({ description: "Page number", example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    description: "Page size",
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
