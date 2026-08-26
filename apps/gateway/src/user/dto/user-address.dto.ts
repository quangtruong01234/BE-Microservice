import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { IsOptionalNotNull } from "../../common/validators/is-optional-not-null.validator";

export class CreateUserAddressDto {
  @ApiProperty({ example: "Nguyen Van A" })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare recipientName: string;

  @ApiProperty({ example: "0987654321" })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  declare phone: string;

  @ApiProperty({ example: "123 Le Loi" })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  declare addressLine: string;

  @ApiProperty({ example: 201, description: "GHN ProvinceID" })
  @IsInt()
  @Min(1)
  declare provinceId: number;

  @ApiProperty({ example: "Ha Noi" })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare provinceName: string;

  @ApiProperty({ example: 1442, description: "GHN DistrictID" })
  @IsInt()
  @Min(1)
  declare districtId: number;

  @ApiProperty({ example: "Quan Ba Dinh" })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare districtName: string;

  @ApiProperty({ example: "20101", description: "GHN WardCode" })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  declare wardCode: string;

  @ApiProperty({ example: "Phuong Cong Vi" })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare wardName: string;

  @ApiPropertyOptional({
    example: true,
    description:
      "Mark this address as the default (first address is forced default)",
  })
  // Stays `@IsOptional()` on CREATE: `createAddress` computes the flag
  // (`existingCount === 0 || dto.isDefault === true`) and overwrites whatever
  // came in, so a `null` here has always answered 201. Turning that into a 400
  // would be a release-class-C tightening for no benefit — same call as the
  // VOUCHER-NULL-01 asymmetry. UPDATE is different: there `null` reaches the
  // NOT NULL column and 500s, so it takes `@IsOptionalNotNull()`.
  @IsOptional()
  @IsBoolean()
  declare isDefault?: boolean;
}

/**
 * Every column on `user_addresses` is NOT NULL, so no field here is "clearable"
 * — an explicit `null` is a client mistake, not an instruction. It used to pass
 * `@IsOptional()`, reach `Object.assign(address, dto)` and fail at the driver
 * as a 500; `@IsOptionalNotNull()` turns it into a 400 naming the field.
 */
export class UpdateUserAddressDto {
  @ApiPropertyOptional({ example: "Nguyen Van A" })
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare recipientName?: string;

  @ApiPropertyOptional({ example: "0987654321" })
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  declare phone?: string;

  @ApiPropertyOptional({ example: "123 Le Loi" })
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  declare addressLine?: string;

  @ApiPropertyOptional({ example: 201, description: "GHN ProvinceID" })
  @IsOptionalNotNull()
  @IsInt()
  @Min(1)
  declare provinceId?: number;

  @ApiPropertyOptional({ example: "Ha Noi" })
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare provinceName?: string;

  @ApiPropertyOptional({ example: 1442, description: "GHN DistrictID" })
  @IsOptionalNotNull()
  @IsInt()
  @Min(1)
  declare districtId?: number;

  @ApiPropertyOptional({ example: "Quan Ba Dinh" })
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare districtName?: string;

  @ApiPropertyOptional({ example: "20101", description: "GHN WardCode" })
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  declare wardCode?: string;

  @ApiPropertyOptional({ example: "Phuong Cong Vi" })
  @IsOptionalNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare wardName?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptionalNotNull()
  @IsBoolean()
  declare isDefault?: boolean;
}
