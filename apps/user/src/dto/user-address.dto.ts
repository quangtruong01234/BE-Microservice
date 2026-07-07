import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateUserAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare recipientName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  declare phone: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  declare addressLine: string;

  @IsInt()
  @Min(1)
  declare provinceId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare provinceName: string;

  @IsInt()
  @Min(1)
  declare districtId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare districtName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  declare wardCode: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare wardName: string;

  @IsOptional()
  @IsBoolean()
  declare isDefault?: boolean;
}

export class UpdateUserAddressDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare recipientName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  declare phone?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  declare addressLine?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  declare provinceId?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare provinceName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  declare districtId?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare districtName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  declare wardCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare wardName?: string;

  @IsOptional()
  @IsBoolean()
  declare isDefault?: boolean;
}
