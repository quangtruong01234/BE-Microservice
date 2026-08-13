import { IsString, IsOptional, IsBoolean, IsIn } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateCategoryDto {
  @ApiProperty({
    description: "Category name",
    example: "Smartphones",
  })
  @IsString()
  declare name: string;

  @ApiPropertyOptional({
    description: "Category description",
    example: "Mobile devices and smartphones",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: "Category active status",
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class ReviewCategoryDto {
  @ApiProperty({
    description: "Review action",
    enum: ["approve", "reject"],
    example: "approve",
  })
  @IsIn(["approve", "reject"])
  declare action: "approve" | "reject";

  @ApiPropertyOptional({
    description: "Review note",
    example: "Looks good",
  })
  @IsOptional()
  @IsString()
  note?: string;
}
