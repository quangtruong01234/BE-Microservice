import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  ArrayMinSize,
  IsInt,
  Min,
  Max,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsCloudinaryUrl } from "../../common/validators/is-cloudinary-url.validator";
import { SkuItemDto, VariationItemDto } from "./create-product.dto";

/**
 * Marks a field the client may clear by sending `null` (the column is nullable
 * in `products`). `@IsOptional()` already skips validation for both `undefined`
 * and `null`, so this is only a readable alias — the meaningful half of the
 * contract is `@RejectsNull()` on every field that is NOT clearable.
 */
const Clearable = IsOptional;

/**
 * Field is optional (`undefined` = leave unchanged) but `null` is NOT a valid
 * value: the column is non-nullable, or clearing it would make the product
 * unusable. Without this, `@IsOptional()` waves `null` through and the write
 * only fails at the DB, surfacing as a 500 instead of a 400.
 */
const RejectsNull = (): PropertyDecorator =>
  ValidateIf((_object: unknown, value: unknown) => value !== undefined);

const CLEAR_HINT = " Send `null` to clear it.";

export class UpdateProductDto {
  @ApiPropertyOptional({
    description: "Product name",
    example: "iPhone 14 Pro Max",
  })
  @RejectsNull()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: "Product description." + CLEAR_HINT,
    example: "Latest iPhone with A16 Bionic chip and ProRAW camera",
    nullable: true,
  })
  @Clearable()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    description: "Product price",
    example: 1299.99,
    minimum: 0,
  })
  @RejectsNull()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  price?: number;

  @ApiPropertyOptional({
    description: "Stock quantity",
    example: 100,
    minimum: 0,
  })
  @RejectsNull()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({
    description: "Product SKU (Stock Keeping Unit)." + CLEAR_HINT,
    example: "IPH14PM-256-BLK",
    nullable: true,
  })
  @Clearable()
  @IsString()
  sku?: string | null;

  @ApiPropertyOptional({
    description: "Brand ID." + CLEAR_HINT,
    example: 1,
    nullable: true,
  })
  @Clearable()
  @IsNumber()
  // `0` is not a brand id: the service guard (`if (dto.brandId)`) reads it as
  // falsy, so it skips the existence check AND both relation branches — the
  // update then echoes `brandId: 0` while the row keeps its old brand. Clearing
  // is `null`, never `0`.
  @Min(1)
  @Type(() => Number)
  brandId?: number | null;

  @ApiPropertyOptional({
    description: "Category IDs",
    example: [1, 2],
    type: [Number],
  })
  @RejectsNull()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  categoryIds?: number[];

  @ApiPropertyOptional({
    description: "Product active status",
    example: true,
  })
  @RejectsNull()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: "Product condition",
    example: "new",
    enum: ["new", "used", "refurbished"],
  })
  @RejectsNull()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({
    description:
      "Product image URLs (upload via Cloudinary first). Send `[]` or `null` to remove every image.",
    type: [String],
    nullable: true,
    example: [
      "https://res.cloudinary.com/example/image/upload/v1/trybuy/products/abc.jpg",
    ],
  })
  @Clearable()
  @IsArray()
  @IsCloudinaryUrl(
    { folder: "trybuy/products", media: "image" },
    { each: true },
  )
  imageUrls?: string[] | null;

  @ApiPropertyOptional({
    description: "Seller notes about the product." + CLEAR_HINT,
    example: "Sản phẩm chính hãng Apple, bảo hành 12 tháng.",
    nullable: true,
  })
  @Clearable()
  @IsString()
  sellerNotes?: string | null;

  @ApiPropertyOptional({
    description: "Khối lượng sản phẩm (gram)." + CLEAR_HINT,
    example: 500,
    minimum: 0,
    nullable: true,
  })
  @Clearable()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  weight?: number | null;

  // Rating system
  @ApiPropertyOptional({
    description: "Average rating (0.0 to 5.0)",
    example: 4.8,
    minimum: 0,
    maximum: 5,
  })
  @RejectsNull()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({
    description: "Number of ratings received",
    example: 89,
    minimum: 0,
  })
  @RejectsNull()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  ratingCount?: number;

  @ApiPropertyOptional({
    description:
      "Optimistic concurrency token — send the `version` read from the product being edited. If another save landed first the request is rejected with 409 instead of silently overwriting it. Omit to keep last-writer-wins.",
    example: 7,
    minimum: 1,
  })
  @RejectsNull()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  version?: number;

  @ApiPropertyOptional({
    description:
      "Variation axes — send together with skuList to edit a SKU matrix product",
    example: [
      { name: "Color", options: ["Red", "Blue"] },
      { name: "Size", options: ["128GB", "256GB"] },
    ],
    type: [VariationItemDto],
  })
  @RejectsNull()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariationItemDto)
  variations?: VariationItemDto[];

  @ApiPropertyOptional({
    description:
      "SKU combinations — the FULL desired set, not a delta. Entries matching an existing tierIdx are updated in place; omitted ones are removed (hard-deleted when never ordered, otherwise deactivated so order history keeps resolving).",
    example: [
      { tierIdx: "[0,0]", price: 999, stockQuantity: 50 },
      { tierIdx: "[0,1]", price: 1099, stockQuantity: 30 },
    ],
    type: [SkuItemDto],
  })
  @RejectsNull()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkuItemDto)
  skuList?: SkuItemDto[];
}
