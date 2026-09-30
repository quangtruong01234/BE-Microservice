import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

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

  @ApiPropertyOptional({
    description:
      "Case- and accent-insensitive substring match on the reported post content (the author is not searched). Blank means no filter; ANDs with status, and total/totalPages/hasNext describe the searched set.",
    example: "scam",
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  q?: string;
}
