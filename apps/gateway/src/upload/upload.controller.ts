import {
  Body,
  Controller,
  Delete,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { UploadService } from "./upload.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

class GetSignatureQueryDto {
  @ApiProperty({ example: "trybuy/posts" })
  @IsString()
  @IsNotEmpty()
  declare folder: string;

  @ApiPropertyOptional({ example: "trybuy/posts/3_abc1234" })
  @IsOptional()
  @IsString()
  declare publicId?: string;
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
  constructor(private readonly uploadService: UploadService) {}

  @Post("signature")
  @ApiOperation({ summary: "Get Cloudinary signed upload params" })
  getSignature(
    @Query() query: GetSignatureQueryDto,
    @Req() req: { user: { userId: number } },
  ): ReturnType<UploadService["generateSignature"]> {
    return this.uploadService.generateSignature(
      query.folder,
      req.user.userId,
      query.publicId,
    );
  }

  @Delete("media")
  @ApiOperation({
    summary: "Get Cloudinary signed delete params and delete the asset",
  })
  async deleteMedia(@Body() body: DeleteMediaDto): Promise<{ result: string }> {
    const sig = this.uploadService.generateDeleteSignature(body.public_id);

    const form = new URLSearchParams();
    form.append("public_id", sig.public_id);
    form.append("signature", sig.signature);
    form.append("timestamp", String(sig.timestamp));
    form.append("api_key", sig.api_key);

    // Try image first, fallback to video
    for (const resourceType of ["image", "video"] as const) {
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloud_name}/${resourceType}/destroy`,
        {
          method: "POST",
          body: form,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        },
      );
      if (res.ok) {
        const json = (await res.json()) as { result: string };
        if (json.result !== "not found") return { result: json.result };
      }
    }

    return { result: "not found" };
  }
}
