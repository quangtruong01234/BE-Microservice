import { ApiProperty } from "@nestjs/swagger";
import {
  IsOptional,
  IsInt,
  IsString,
  IsNotEmpty,
  MaxLength,
  Min,
  IsBoolean,
} from "class-validator";
import { IsOptionalNotNull } from "../../common/validators/is-optional-not-null.validator";

/**
 * `location` is the only nullable column on `inventory_v2`, so it is the only
 * field here where `null` legitimately means "clear it". The rest map to NOT
 * NULL columns and take `@IsOptionalNotNull()` — a `null` reached
 * `repository.update()` and surfaced as a driver 500 instead of a 400.
 */
export class UpdateInventoryDto {
  @ApiProperty({
    description:
      "Inventory SKU. Accepted so a client can send back the row it just read; must stay unique across inventory rows.",
    example: "IPHONE15-BK-128",
    maxLength: 100,
    required: false,
  })
  @IsOptionalNotNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sku?: string;

  @ApiProperty({
    description: "Available stock quantity",
    example: 75,
    minimum: 0,
    type: "integer",
    required: false,
  })
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  availableStock?: number;

  @ApiProperty({
    description: "Reserved stock quantity",
    example: 5,
    minimum: 0,
    type: "integer",
    required: false,
  })
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  reservedStock?: number;

  @ApiProperty({
    description: "Minimum stock threshold",
    example: 15,
    minimum: 0,
    type: "integer",
    required: false,
  })
  @IsOptionalNotNull()
  @IsInt()
  @Min(0)
  minimumStock?: number;

  @ApiProperty({
    description: "Warehouse location",
    example: "WAREHOUSE-A1-UPDATED",
    maxLength: 50,
    required: false,
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({
    description: "Active status",
    example: true,
    type: "boolean",
    required: false,
  })
  @IsOptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}
