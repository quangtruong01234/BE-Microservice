import { OmitType, PartialType } from "@nestjs/mapped-types";
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { CreateProductDto } from "./create-product.dto";

/**
 * Columns that are nullable in `products` and that a client may CLEAR by
 * sending `null` on PATCH. They are omitted from the inherited create shape and
 * redeclared below so their type carries `null` — otherwise they would be
 * `T | undefined` and the service could not tell "clear this" from "leave
 * alone". Validators are the same ones the create DTO applies.
 */
const CLEARABLE_FIELDS = [
  "description",
  "sku",
  "brandId",
  "sellerNotes",
  "weight",
  "imageUrls",
] as const;

/** Every field is optional — `undefined` means "leave unchanged". */
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, CLEARABLE_FIELDS),
) {
  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  sku?: string | null;

  @IsOptional()
  @IsNumber()
  // Mirrors the gateway DTO: `0` would silently no-op (see the note there).
  @Min(1)
  @Type(() => Number)
  brandId?: number | null;

  @IsOptional()
  @IsString()
  sellerNotes?: string | null;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  weight?: number | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[] | null;

  // Optimistic concurrency token read from the product being edited. When sent,
  // a mismatch means someone else saved first and the edit is rejected (409).
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  version?: number;
}
