import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
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
}
