import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import { IsCloudinaryUrl } from "../../common/validators/is-cloudinary-url.validator";
import { IsPublicId } from "../../common/validators/is-public-id.validator";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";

export class CreatePostDto {
  @ApiProperty({ description: "Post content" })
  @IsNotEmpty()
  @IsString()
  @MaxLength(5000)
  declare content: string;

  @ApiPropertyOptional({ description: "Optional image URLs", type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsCloudinaryUrl({ folder: "trybuy/posts", media: "image" }, { each: true })
  imageUrls?: string[];

  @ApiPropertyOptional({ description: "Optional video URL" })
  @IsOptional()
  @IsCloudinaryUrl({ folder: "trybuy/posts", media: "video" })
  videoUrl?: string;

  @ApiPropertyOptional({ description: "Optional attached product ID" })
  @IsOptional()
  @IsString()
  @IsPublicId(PUBLIC_ID_PREFIXES.PRODUCT)
  productId?: string;
}
