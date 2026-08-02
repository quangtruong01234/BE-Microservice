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
} from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsCloudinaryUrl } from "../../common/validators/is-cloudinary-url.validator";

export class UpdateProductDto {
  @ApiPropertyOptional({
    description: "Product name",
    example: "iPhone 14 Pro Max",
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: "Product description",
    example: "Latest iPhone with A16 Bionic chip and ProRAW camera",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: "Product price",
    example: 1299.99,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  price?: number;

  @ApiPropertyOptional({
    description: "Stock quantity",
    example: 100,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({
    description: "Product SKU (Stock Keeping Unit)",
    example: "IPH14PM-256-BLK",
  })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({
    description: "Brand ID",
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  brandId?: number;

  @ApiPropertyOptional({
    description: "Category IDs",
    example: [1, 2],
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  categoryIds?: number[];

  @ApiPropertyOptional({
    description: "Product active status",
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: "Product condition",
    example: "new",
    enum: ["new", "used", "refurbished"],
  })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({
    description: "Product image URLs (upload via Cloudinary first)",
    type: [String],
    example: [
      "https://res.cloudinary.com/example/image/upload/v1/trybuy/products/abc.jpg",
    ],
  })
  @IsOptional()
  @IsArray()
  @IsCloudinaryUrl(
    { folder: "trybuy/products", media: "image" },
    { each: true },
  )
  imageUrls?: string[];

  @ApiPropertyOptional({
    description: "Seller notes about the product",
    example: "Sản phẩm chính hãng Apple, bảo hành 12 tháng.",
  })
  @IsOptional()
  @IsString()
  sellerNotes?: string;

  @ApiPropertyOptional({
    description: "Khối lượng sản phẩm (gram)",
    example: 500,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  weight?: number;

  // Rating system
  @ApiPropertyOptional({
    description: "Average rating (0.0 to 5.0)",
    example: 4.8,
    minimum: 0,
    maximum: 5,
  })
  @IsOptional()
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
  @IsOptional()
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
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  version?: number;
}
