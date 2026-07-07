import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export class ReportedPostsQueryDto {
  @ApiPropertyOptional({
    description: "Filter report rows by resolution status",
    enum: ["pending", "resolved", "dismissed"],
    default: "pending",
  })
  @IsOptional()
  @IsIn(["pending", "resolved", "dismissed"])
  status?: "pending" | "resolved" | "dismissed";

  @ApiPropertyOptional({ description: "Page number", default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: "Items per page",
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
