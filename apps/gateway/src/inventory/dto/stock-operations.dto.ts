import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, IsNotEmpty } from 'class-validator';

export class CheckStockDto {
  @ApiProperty({ 
    description: 'Product ID to check stock',
    example: 1,
    type: 'integer'
  })
  @IsInt()
  @IsNotEmpty()
  productId: number;

  @ApiProperty({ 
    description: 'Quantity to check availability',
    example: 5,
    minimum: 1,
    type: 'integer'
  })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class ReserveStockDto {
  @ApiProperty({ 
    description: 'Product ID to reserve stock',
    example: 1,
    type: 'integer'
  })
  @IsInt()
  @IsNotEmpty()
  productId: number;

  @ApiProperty({ 
    description: 'Quantity to reserve',
    example: 3,
    minimum: 1,
    type: 'integer'
  })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class ReleaseStockDto {
  @ApiProperty({ 
    description: 'Product ID to release stock',
    example: 1,
    type: 'integer'
  })
  @IsInt()
  @IsNotEmpty()
  productId: number;

  @ApiProperty({ 
    description: 'Quantity to release',
    example: 2,
    minimum: 1,
    type: 'integer'
  })
  @IsInt()
  @Min(1)
  quantity: number;
}