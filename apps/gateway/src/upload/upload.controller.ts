import { Controller, Post, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsString, IsNotEmpty } from "class-validator";
import { UploadService } from "./upload.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

class GetSignatureQueryDto {
  @ApiProperty({ example: "trybuy/products" })
  @IsString()
  @IsNotEmpty()
  declare folder: string;
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
  ): ReturnType<UploadService["generateSignature"]> {
    return this.uploadService.generateSignature(query.folder);
  }
}
