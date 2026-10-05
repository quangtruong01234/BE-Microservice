import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, Max, Min } from "class-validator";

// Only the literal strings "true" / "false" map to a boolean; anything else is
// passed through so @IsBoolean() answers a 400 instead of silently reading
// `?unreadOnly=yes` as false.
function toStrictBoolean(value: unknown): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

export class GetNotificationsQueryDto {
  @ApiPropertyOptional({ description: "Page number", default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: "Items per page",
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({
    description:
      "NOTIF-INBOX-01 — only unread notifications; total/totalPages follow the filter",
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => toStrictBoolean(value))
  @IsBoolean()
  unreadOnly?: boolean = false;
}
