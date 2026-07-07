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
  @IsOptional()
  @IsBoolean()
  declare isDefault?: boolean;
}

export class UpdateUserAddressDto {
  @ApiPropertyOptional({ example: "Nguyen Van A" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare recipientName?: string;

  @ApiPropertyOptional({ example: "0987654321" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  declare phone?: string;

  @ApiPropertyOptional({ example: "123 Le Loi" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  declare addressLine?: string;

  @ApiPropertyOptional({ example: 201, description: "GHN ProvinceID" })
  @IsOptional()
  @IsInt()
  @Min(1)
  declare provinceId?: number;

  @ApiPropertyOptional({ example: "Ha Noi" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare provinceName?: string;

  @ApiPropertyOptional({ example: 1442, description: "GHN DistrictID" })
  @IsOptional()
  @IsInt()
  @Min(1)
  declare districtId?: number;

  @ApiPropertyOptional({ example: "Quan Ba Dinh" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare districtName?: string;

  @ApiPropertyOptional({ example: "20101", description: "GHN WardCode" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  declare wardCode?: string;

  @ApiPropertyOptional({ example: "Phuong Cong Vi" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  declare wardName?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  declare isDefault?: boolean;
}
