import {
  BadGatewayException,
  Body,
  Controller,
  Delete,
  Logger,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { UPLOAD_MESSAGE } from "libs/constant/response-message.constant";
import { UploadService } from "./upload.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RateLimit } from "../common/decorators/rate-limit.decorator";

export class GetSignatureQueryDto {
  @ApiProperty({ example: "trybuy/products" })
  @IsString()
  @IsNotEmpty()
  declare folder: string;

  @ApiPropertyOptional({
    example: "3_abc1234",
    description:
      "Optional custom public id. Must be prefixed with the caller's internal " +
      "numeric id (`<id>_...`); opaque `usr_...` prefixes are not accepted. " +
      "Prefer omitting it — the server generates an owner-prefixed id and " +
      "returns it as `public_id`.",
  })
  @IsOptional()
  @IsString()
  declare publicId?: string;

  @ApiPropertyOptional({
    deprecated: true,
    description:
      "Ignored. The authenticated JWT user id is authoritative. Any string " +
      "(legacy numeric or opaque `usr_...`) is accepted and discarded.",
  })
  @IsOptional()
  @IsString()
  declare userId?: string;
}

class DeleteMediaDto {
  @ApiProperty({ example: "trybuy/posts/3_abc123" })
  @IsString()
  @IsNotEmpty()
  declare public_id: string;
}

@ApiTags("upload")
@Controller("upload")
@UseGuards(JwtAuthGuard)
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(private readonly uploadService: UploadService) {}

  @Post("signature")
  @RateLimit({ limit: 60, ttl: 60 })
  @ApiOperation({ summary: "Get Cloudinary signed upload params" })
  getSignature(
    @Query() query: GetSignatureQueryDto,
    @Req() req: { user: { id: number } },
  ): ReturnType<UploadService["generateSignature"]> {
    return this.uploadService.generateSignature(
      query.folder,
      req.user.id,
      query.publicId,
    );
  }

  @Delete("media")
  @RateLimit({ limit: 30, ttl: 60 })
  @ApiOperation({
    summary: "Get Cloudinary signed delete params and delete the asset",
  })
  async deleteMedia(
    @Body() body: DeleteMediaDto,
    @Req() req: { user: { id: number; role?: string } },
  ): Promise<{ result: string }> {
    const sig = this.uploadService.generateDeleteSignature(
      body.public_id,
      req.user.id,
      req.user.role ?? "user",
    );

    const form = new URLSearchParams();
    form.append("public_id", sig.public_id);
    form.append("signature", sig.signature);
    form.append("timestamp", String(sig.timestamp));
    form.append("api_key", sig.api_key);

    // Try image first, fallback to video. Cloudinary returns HTTP 200 with
    // { result: "not found" } for a missing asset, so a non-ok response is a
    // real upstream failure (auth, rate limit, outage) — surface it instead of
    // masking it as "not found".
    let lastResult = "not found";
    for (const resourceType of ["image", "video"] as const) {
      let res: Response;
      try {
        res = await fetch(
          `https://api.cloudinary.com/v1_1/${sig.cloud_name}/${resourceType}/destroy`,
          {
            method: "POST",
            body: form,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          },
        );
      } catch (error) {
        this.logger.error(
          `Cloudinary destroy request failed for ${sig.public_id}`,
          error instanceof Error ? error.stack : String(error),
        );
        throw new ServiceUnavailableException(
          UPLOAD_MESSAGE.MEDIA_SERVICE_UNAVAILABLE,
        );
      }

      if (!res.ok) {
        const details = await res.text().catch(() => "");
        this.logger.error(
          `Cloudinary destroy returned ${res.status} for ${sig.public_id}: ${details}`,
        );
        throw new BadGatewayException(UPLOAD_MESSAGE.DELETE_FAILED);
      }

      const json = (await res.json()) as { result: string };
      if (json.result !== "not found") {
        return { result: json.result };
      }
      lastResult = json.result;
    }

    return { result: lastResult };
  }
}
