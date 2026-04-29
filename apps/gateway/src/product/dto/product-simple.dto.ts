import { IsString, IsNumber, IsOptional, IsBoolean, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ============================================================================
// PRODUCT DTOs
// ============================================================================

export class CreateProductDto {
  @ApiProperty({
    description: 'Product name',
    example: 'iPhone 14 Pro Max',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Product description',
    example: 'Latest iPhone with A16 Bionic chip and ProRAW camera',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Product price',
    example: 1299.99,
    minimum: 0,
  })
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  price: number;

  @ApiPropertyOptional({
    description: 'Initial stock quantity',
    example: 100,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  stockQuantity?: number = 0;

  @ApiProperty({
    description: 'Product SKU (Stock Keeping Unit)',
    example: 'IPH14PM-256-BLK',
  })
  @IsString()
  sku: string;

  @ApiPropertyOptional({
    description: 'Brand ID',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  brandId?: number;

  @ApiProperty({
    description: 'Category ID',
    example: 1,
  })
  @IsNumber()
  @Type(() => Number)
  categoryId: number;

  @ApiPropertyOptional({
    description: 'User ID (creator of the product)',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  userId?: number;

  @ApiPropertyOptional({
    description: 'Product image URL',
    example: 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?auto=format&fit=crop&q=80&w=600',
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Product active status',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;

  // Social engagement metrics
  @ApiPropertyOptional({
    description: 'Number of likes',
    example: 45,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  likesCount?: number = 0;

  @ApiPropertyOptional({
    description: 'Number of comments',
    example: 12,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  commentsCount?: number = 0;

  @ApiPropertyOptional({
    description: 'Number of shares',
    example: 8,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  sharesCount?: number = 0;

  @ApiPropertyOptional({
    description: 'Number of views',
    example: 850,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  viewCount?: number = 0;

  // Product status for timeline/feed
  @ApiPropertyOptional({
    description: 'Whether product is featured',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean = false;

  @ApiPropertyOptional({
    description: 'Whether product is trending',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isTrending?: boolean = false;

  // Product condition and seller info
  @ApiPropertyOptional({
    description: 'Product condition',
    example: 'new',
    enum: ['new', 'used', 'refurbished'],
    default: 'new',
  })
  @IsOptional()
  @IsString()
  condition?: string = 'new';

  @ApiPropertyOptional({
    description: 'Seller notes about the product',
    example: 'Sản phẩm chính hãng Apple, bảo hành 12 tháng tại các trung tâm bảo hành Apple Việt Nam.',
  })
  @IsOptional()
  @IsString()
  sellerNotes?: string;

  // Rating system
  @ApiPropertyOptional({
    description: 'Average rating (0.0 to 5.0)',
    example: 4.8,
    minimum: 0,
    maximum: 5,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(5)
  rating?: number = 0;

  @ApiPropertyOptional({
    description: 'Number of ratings received',
    example: 89,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  ratingCount?: number = 0;
}

export class UpdateProductDto {
  @ApiPropertyOptional({
    description: 'Product name',
    example: 'iPhone 14 Pro Max',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Product description',
    example: 'Latest iPhone with A16 Bionic chip and ProRAW camera',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Product price',
    example: 1299.99,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  price?: number;

  @ApiPropertyOptional({
    description: 'Stock quantity',
    example: 100,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({
    description: 'Product SKU (Stock Keeping Unit)',
    example: 'IPH14PM-256-BLK',
  })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({
    description: 'Brand ID',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  brandId?: number;

  @ApiPropertyOptional({
    description: 'Category ID',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  categoryId?: number;

  @ApiPropertyOptional({
    description: 'Product image URL',
    example: 'https://example.com/images/iphone14pro.jpg',
  })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Product active status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Social engagement metrics
  @ApiPropertyOptional({
    description: 'Number of likes',
    example: 45,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  likesCount?: number;

  @ApiPropertyOptional({
    description: 'Number of comments',
    example: 12,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  commentsCount?: number;

  @ApiPropertyOptional({
    description: 'Number of shares',
    example: 8,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  sharesCount?: number;

  @ApiPropertyOptional({
    description: 'Number of views',
    example: 850,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  viewCount?: number;

  // Product status for timeline/feed
  @ApiPropertyOptional({
    description: 'Whether product is featured',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({
    description: 'Whether product is trending',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isTrending?: boolean;

  // Product condition and seller info
  @ApiPropertyOptional({
    description: 'Product condition',
    example: 'new',
    enum: ['new', 'used', 'refurbished'],
  })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({
    description: 'Seller notes about the product',
    example: 'Sản phẩm chính hãng Apple, bảo hành 12 tháng.',
  })
  @IsOptional()
  @IsString()
  sellerNotes?: string;

  // Rating system
  @ApiPropertyOptional({
    description: 'Average rating (0.0 to 5.0)',
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
    description: 'Number of ratings received',
    example: 89,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  ratingCount?: number;
}

export class GetProductsQueryDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Search keyword',
    example: 'iPhone',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by category ID',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  categoryId?: number;

  @ApiPropertyOptional({
    description: 'Filter by brand ID',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  brandId?: number;

  @ApiPropertyOptional({
    description: 'Minimum price filter',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minPrice?: number;

  @ApiPropertyOptional({
    description: 'Maximum price filter',
    example: 2000,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  maxPrice?: number;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Sort by field',
    example: 'createdAt',
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'DESC',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  // Social features filters
  @ApiPropertyOptional({
    description: 'Filter by featured status',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by trending status',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isTrending?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by product condition',
    example: 'new',
    enum: ['new', 'used', 'refurbished'],
  })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({
    description: 'Minimum rating filter',
    example: 4.0,
    minimum: 0,
    maximum: 5,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minRating?: number;

  @ApiPropertyOptional({
    description: 'Maximum rating filter',
    example: 5.0,
    minimum: 0,
    maximum: 5,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  maxRating?: number;
}

// ============================================================================
// BRAND DTOs
// ============================================================================

export class CreateBrandDto {
  @ApiProperty({
    description: 'Brand name',
    example: 'Apple',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Brand description',
    example: 'Technology company known for innovative products',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Brand active status',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

// ============================================================================
// CATEGORY DTOs
// ============================================================================

export class CreateCategoryDto {
  @ApiProperty({
    description: 'Category name',
    example: 'Smartphones',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Category description',
    example: 'Mobile devices and smartphones',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Category active status',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}