import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ERROR_CODE } from "libs/constant/error-code.constant";
import { IsCloudinaryUrl } from "../../common/validators/is-cloudinary-url.validator";

export const RETURN_REQUEST_MAX_IMAGES = 5;

/** RETURN-PHOTO-ERRCODE-01 — tags every imageUrls rule for the 400 errorCode. */
const RETURN_PHOTO_ERROR_CONTEXT = {
  errorCode: ERROR_CODE.RETURN_PHOTO_INVALID,
};

export class CreateReturnRequestDto {
  @ApiProperty({
    description: "Reason the buyer is requesting a return/refund",
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  declare reason: string;

  @ApiPropertyOptional({
    description:
      "RETURN-PHOTO-01 — up to 5 evidence photos. Each must be a Cloudinary " +
      "image URL uploaded by the caller into the `trybuy/returns` folder " +
      "(signature: GET /api/upload/signature?folder=trybuy/returns). " +
      "A 400 that only this field fails carries `errorCode: RETURN_PHOTO_INVALID`; " +
      "another account's upload is a 403 with `errorCode: MEDIA_NOT_OWNED`.",
    type: [String],
    maxItems: RETURN_REQUEST_MAX_IMAGES,
    example: [
      "https://res.cloudinary.com/<cloud>/image/upload/v1/trybuy/returns/3_abc.jpg",
    ],
  })
  @IsOptional()
  @IsArray({ context: RETURN_PHOTO_ERROR_CONTEXT })
  @ArrayMaxSize(RETURN_REQUEST_MAX_IMAGES, {
    context: RETURN_PHOTO_ERROR_CONTEXT,
  })
  @ArrayUnique({ context: RETURN_PHOTO_ERROR_CONTEXT })
  @IsCloudinaryUrl(
    { folder: "trybuy/returns", media: "image" },
    { each: true, context: RETURN_PHOTO_ERROR_CONTEXT },
  )
  declare imageUrls?: string[];
}

export class RejectReturnRequestDto {
  @ApiProperty({
    description: "Reason the seller/admin is rejecting the return request",
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  declare reason: string;
}

export class ReturnRequestsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare limit?: number;

  @ApiPropertyOptional({
    enum: ["pending_review", "approved", "rejected"],
    description: "Filter by request status (seller/admin list only)",
  })
  @IsOptional()
  @IsIn(["pending_review", "approved", "rejected"])
  declare status?: string;

  @ApiPropertyOptional({
    description:
      "Search — case-insensitive substring match on the return request code (rr_…) or the order code (ord_…). Blank means no filter; ANDs with status, and total/totalPages/hasNext describe the searched set.",
    example: "ord_516a",
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  declare q?: string;
}
