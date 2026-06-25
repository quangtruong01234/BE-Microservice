import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from "class-validator";

export class CreatePostDto {
  @ApiProperty({ description: "Post content" })
  @IsNotEmpty()
  @IsString()
  @MaxLength(5000)
  declare content: string;

  @ApiPropertyOptional({ description: "Optional image URLs", type: [String] })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  imageUrls?: string[];

  @ApiPropertyOptional({ description: "Optional video URL" })
  @IsOptional()
  @IsUrl()
  videoUrl?: string;

  @ApiPropertyOptional({ description: "Optional attached product ID" })
  @IsOptional()
  @IsInt()
  @Min(1)
  productId?: number;
}
