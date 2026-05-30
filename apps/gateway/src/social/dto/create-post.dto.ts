import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
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
  content!: string;

  @ApiPropertyOptional({ description: "Optional image URL" })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;
}
