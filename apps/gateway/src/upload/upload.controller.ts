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
import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { UploadService } from "./upload.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RateLimit } from "../common/decorators/rate-limit.decorator";

class GetSignatureQueryDto {
  @ApiProperty({ example: "trybuy/products" })
  @IsString()
  @IsNotEmpty()
  declare folder: string;

  @ApiPropertyOptional({ example: "3_abc1234" })
  @IsOptional()
  @IsString()
  declare publicId?: string;

  @ApiPropertyOptional({
    deprecated: true,
    description: "Ignored. The authenticated JWT user id is authoritative.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  declare userId?: number;
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
        throw new ServiceUnavailableException("Media service is unavailable");
      }

      if (!res.ok) {
        const details = await res.text().catch(() => "");
        this.logger.error(
          `Cloudinary destroy returned ${res.status} for ${sig.public_id}: ${details}`,
        );
        throw new BadGatewayException("Failed to delete media");
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
