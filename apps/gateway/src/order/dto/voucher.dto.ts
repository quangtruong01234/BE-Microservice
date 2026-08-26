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
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";
import { IsPublicId } from "../../common/validators/is-public-id.validator";

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

/**
 * VOUCHER-SHOP-01: basket voucher list. Same item shape the checkout and the
 * voucher preview already send, so the gateway can price it with the very same
 * `enrichOrderItems()`.
 */
export class AvailableVouchersDto {
  @ApiProperty({
    type: [OrderItemDto],
    description: "Basket items to evaluate every voucher against",
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

  @ApiPropertyOptional({
    description:
      "Owning shop (public user id). Omit for a platform-wide voucher. " +
      "Admin-only — the shop-facing create endpoint always owns its own voucher.",
    example: "usr_a1b2c3d4e5f6g7h8",
  })
  @IsOptional()
  @IsPublicId(PUBLIC_ID_PREFIXES.USER)
  sellerId?: string;
}

/**
 * VOUCHER-EDIT-01: partial edit of an existing voucher.
 *
 * `code`, `discountType` and `discountValue` are absent on purpose — they are
 * immutable once the voucher exists (orders already priced against them cannot
 * be re-priced). To change them, deactivate and issue a new code.
 *
 * Every nullable field accepts an explicit `null` to CLEAR it (uncapped /
 * unlimited / no window / no description); omit the key to leave it untouched.
 */
export class UpdateVoucherDto {
  @ApiPropertyOptional({
    description: "Human-readable description — `null` clears it",
    example: "10% off your order",
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @ApiPropertyOptional({
    description:
      "Minimum order subtotal (VND). Cannot be raised once the voucher has been redeemed.",
    example: 100000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @ApiPropertyOptional({
    description:
      "Cap on the discount for percent vouchers (VND) — `null` = uncapped",
    example: 50000,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number | null;

  @ApiPropertyOptional({
    description:
      "Total redemptions allowed across all users — `null` = unlimited. " +
      "Must not be below the redemptions already made.",
    example: 100,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  @ApiPropertyOptional({
    description: "Redemptions allowed per user — `null` = unlimited",
    example: 1,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  perUserLimit?: number | null;

  @ApiPropertyOptional({
    description: "ISO-8601 start of the validity window — `null` clears it",
    example: "2026-07-01T00:00:00.000Z",
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @ApiPropertyOptional({
    description: "ISO-8601 expiry of the validity window — `null` clears it",
    example: "2026-08-01T00:00:00.000Z",
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @ApiPropertyOptional({
    description:
      "Activate or deactivate the voucher. `true` is how a deactivated " +
      "voucher is switched back on.",
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
