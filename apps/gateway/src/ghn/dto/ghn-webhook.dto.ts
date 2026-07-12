import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

// GHN webhook payload. Real GHN callbacks send PascalCase fields plus many
// extras (Time, Type, CODAmount, ...) — this DTO is validated with a
// route-level non-whitelisting pipe so unknown fields pass through, while
// wrong-typed known fields are rejected with 400.
export class GhnWebhookDto {
  @ApiPropertyOptional({ description: "GHN order code (real GHN callbacks)" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  declare OrderCode?: string;

  @ApiPropertyOptional({ description: "GHN status (real GHN callbacks)" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  declare Status?: string;

  @ApiPropertyOptional({
    description: "GHN order code (manual/internal tests)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  declare order_code?: string;

  @ApiPropertyOptional({ description: "GHN status (manual/internal tests)" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  declare status?: string;
}
