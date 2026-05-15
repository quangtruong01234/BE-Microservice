import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsDateString,
  IsArray,
  Min,
  Max,
} from "class-validator";
import { Type, Transform } from "class-transformer";

// Product Types and Enums (mirror from product module)
export enum ProductType {
  SIMPLE = "SIMPLE",
  CONFIGURABLE = "CONFIGURABLE",
  BUNDLE = "BUNDLE",
  DIGITAL = "DIGITAL",
  SERVICE = "SERVICE",
}

export enum ProductStatus {
  DRAFT = "DRAFT",
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  OUT_OF_STOCK = "OUT_OF_STOCK",
  DISCONTINUED = "DISCONTINUED",
}

export enum ProductVisibility {
  PUBLIC = "PUBLIC",
  PRIVATE = "PRIVATE",
  MEMBERS_ONLY = "MEMBERS_ONLY",
  SPECIFIC_USERS = "SPECIFIC_USERS",
}

export enum InventoryPolicy {
  DENY = "DENY",
  CONTINUE = "CONTINUE",
}

// ===== CREATE PRODUCT DTO =====
export class CreateProductDto {
  @ApiProperty({
    description: "Product SKU (Stock Keeping Unit)",
    example: "IPHONE15-128GB-RED",
  })
  @IsString()
  sku: string;

  @ApiProperty({ description: "Product name", example: "iPhone 15 128GB Red" })
  @IsString()
  name: string;

  @ApiProperty({
    description: "SEO-friendly URL slug",
    example: "iphone-15-128gb-red",
  })
  @IsString()
  slug: string;

  @ApiPropertyOptional({ description: "Short description" })
  @IsOptional()
  @IsString()
  shortDescription?: string;

  @ApiPropertyOptional({ description: "Full product description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "Brand ID" })
  @IsOptional()
  @IsNumber()
  brandId?: number;

  @ApiProperty({ description: "Primary category ID" })
  @IsNumber()
  primaryCategoryId: number;

  @ApiPropertyOptional({ description: "Product type", enum: ProductType })
  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;

  @ApiProperty({ description: "Base price", example: 25990000 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  basePrice: number;

  @ApiPropertyOptional({
    description: "Compare price (original price)",
    example: 28990000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  comparePrice?: number;

  @ApiPropertyOptional({ description: "Cost price" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  costPrice?: number;

  @ApiPropertyOptional({ description: "Track inventory", default: true })
  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;

  @ApiPropertyOptional({
    description: "Inventory policy",
    enum: InventoryPolicy,
  })
  @IsOptional()
  @IsEnum(InventoryPolicy)
  inventoryPolicy?: InventoryPolicy;

  // Physical properties
  @ApiPropertyOptional({ description: "Weight in kg" })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  weight?: number;

  @ApiPropertyOptional({ description: "Length in cm" })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  length?: number;

  @ApiPropertyOptional({ description: "Width in cm" })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  width?: number;

  @ApiPropertyOptional({ description: "Height in cm" })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  height?: number;

  // Status and visibility
  @ApiPropertyOptional({ description: "Product status", enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({
    description: "Product visibility",
    enum: ProductVisibility,
  })
  @IsOptional()
  @IsEnum(ProductVisibility)
  visibility?: ProductVisibility;

  // SEO fields
  @ApiPropertyOptional({ description: "Meta title for SEO" })
  @IsOptional()
  @IsString()
  metaTitle?: string;

  @ApiPropertyOptional({ description: "Meta description for SEO" })
  @IsOptional()
  @IsString()
  metaDescription?: string;

  @ApiPropertyOptional({ description: "Meta keywords for SEO" })
  @IsOptional()
  @IsString()
  metaKeywords?: string;

  @ApiPropertyOptional({ description: "Featured image URL" })
  @IsOptional()
  @IsString()
  featuredImageUrl?: string;

  // Special flags
  @ApiPropertyOptional({ description: "Is featured product", default: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ description: "Is bestseller", default: false })
  @IsOptional()
  @IsBoolean()
  isBestseller?: boolean;

  @ApiPropertyOptional({ description: "Is new arrival", default: false })
  @IsOptional()
  @IsBoolean()
  isNewArrival?: boolean;

  @ApiPropertyOptional({ description: "Is on sale", default: false })
  @IsOptional()
  @IsBoolean()
  isOnSale?: boolean;

  // Date management
  @ApiPropertyOptional({ description: "Available from date" })
  @IsOptional()
  @IsDateString()
  availableFrom?: Date;

  @ApiPropertyOptional({ description: "Available to date" })
  @IsOptional()
  @IsDateString()
  availableTo?: Date;

  // Shipping
  @ApiPropertyOptional({ description: "Requires shipping", default: true })
  @IsOptional()
  @IsBoolean()
  requiresShipping?: boolean;

  @ApiPropertyOptional({ description: "Shipping class" })
  @IsOptional()
  @IsString()
  shippingClass?: string;

  @ApiPropertyOptional({ description: "Minimum order quantity", default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  minOrderQuantity?: number;

  @ApiPropertyOptional({ description: "Maximum order quantity" })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxOrderQuantity?: number;

  @ApiPropertyOptional({ description: "Custom fields as JSON" })
  @IsOptional()
  customFields?: Record<string, any>;

  @ApiPropertyOptional({ description: "Additional category IDs" })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  categoryIds?: number[];
}

// ===== UPDATE PRODUCT DTO =====
export class UpdateProductDto {
  @ApiProperty({ description: "Product ID" })
  @IsNumber()
  id: number;

  @ApiPropertyOptional({ description: "Product SKU" })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ description: "Product name" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: "SEO slug" })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ description: "Short description" })
  @IsOptional()
  @IsString()
  shortDescription?: string;

  @ApiPropertyOptional({ description: "Full description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "Brand ID" })
  @IsOptional()
  @IsNumber()
  brandId?: number;

  @ApiPropertyOptional({ description: "Primary category ID" })
  @IsOptional()
  @IsNumber()
  primaryCategoryId?: number;

  @ApiPropertyOptional({ description: "Base price" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  basePrice?: number;

  @ApiPropertyOptional({ description: "Compare price" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  comparePrice?: number;

  @ApiPropertyOptional({ description: "Product status", enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({
    description: "Product visibility",
    enum: ProductVisibility,
  })
  @IsOptional()
  @IsEnum(ProductVisibility)
  visibility?: ProductVisibility;

  @ApiPropertyOptional({ description: "Featured image URL" })
  @IsOptional()
  @IsString()
  featuredImageUrl?: string;

  @ApiPropertyOptional({ description: "Is featured" })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ description: "Custom fields" })
  @IsOptional()
  customFields?: Record<string, any>;
}

// ===== GET PRODUCTS QUERY DTO =====
export class GetProductsQueryDto {
  @ApiPropertyOptional({ description: "Page number", default: 1, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: "Items per page",
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({ description: "Search query (name, description, SKU)" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "Filter by category ID" })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  categoryId?: number;

  @ApiPropertyOptional({ description: "Filter by brand ID" })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  brandId?: number;

  @ApiPropertyOptional({ description: "Filter by status", enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({
    description: "Filter by product type",
    enum: ProductType,
  })
  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;

  @ApiPropertyOptional({
    description: "Filter by visibility",
    enum: ProductVisibility,
  })
  @IsOptional()
  @IsEnum(ProductVisibility)
  visibility?: ProductVisibility;

  @ApiPropertyOptional({ description: "Filter featured products" })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === "true" || value === true)
  isFeatured?: boolean;

  @ApiPropertyOptional({ description: "Filter bestsellers" })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === "true" || value === true)
  isBestseller?: boolean;

  @ApiPropertyOptional({ description: "Filter new arrivals" })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === "true" || value === true)
  isNewArrival?: boolean;

  @ApiPropertyOptional({ description: "Filter products on sale" })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === "true" || value === true)
  isOnSale?: boolean;

  @ApiPropertyOptional({ description: "Minimum price" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minPrice?: number;

  @ApiPropertyOptional({ description: "Maximum price" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  maxPrice?: number;

  @ApiPropertyOptional({ description: "Sort by field", default: "createdAt" })
  @IsOptional()
  @IsString()
  sortBy?: string = "createdAt";

  @ApiPropertyOptional({
    description: "Sort order",
    enum: ["ASC", "DESC"],
    default: "DESC",
  })
  @IsOptional()
  @IsString()
  sortOrder?: "ASC" | "DESC" = "DESC";
}

// ===== PRODUCT VARIANT DTOs =====
export class CreateProductVariantDto {
  @ApiProperty({ description: "Product ID" })
  @IsNumber()
  productId: number;

  @ApiProperty({
    description: "Variant SKU",
    example: "IPHONE15-128GB-RED-VARIANT",
  })
  @IsString()
  sku: string;

  @ApiPropertyOptional({ description: "Barcode" })
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional({
    description: "Variant price (overrides product price)",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @ApiPropertyOptional({ description: "Variant compare price" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  comparePrice?: number;

  @ApiPropertyOptional({
    description: "Inventory quantity for this variant",
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  inventoryQuantity?: number = 0;

  @ApiPropertyOptional({ description: "Variant image URL" })
  @IsOptional()
  @IsString()
  featuredImageUrl?: string;

  @ApiPropertyOptional({
    description: "Variant attributes (color, size, etc.)",
    example: { color: "Red", size: "128GB" },
  })
  @IsOptional()
  variantAttributes?: Record<string, any>;

  @ApiPropertyOptional({ description: "Is variant active", default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class UpdateProductVariantDto {
  @ApiProperty({ description: "Variant ID" })
  @IsNumber()
  id: number;

  @ApiPropertyOptional({ description: "Variant SKU" })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ description: "Variant price" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @ApiPropertyOptional({ description: "Inventory quantity" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  inventoryQuantity?: number;

  @ApiPropertyOptional({ description: "Variant image URL" })
  @IsOptional()
  @IsString()
  featuredImageUrl?: string;

  @ApiPropertyOptional({ description: "Variant attributes" })
  @IsOptional()
  variantAttributes?: Record<string, any>;

  @ApiPropertyOptional({ description: "Is variant active" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
