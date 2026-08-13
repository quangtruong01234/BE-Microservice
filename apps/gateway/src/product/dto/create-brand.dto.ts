import { IsString, IsOptional, IsBoolean, IsIn } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateBrandDto {
  @ApiProperty({
    description: "Brand name",
    example: "Apple",
  })
  @IsString()
  declare name: string;

  @ApiPropertyOptional({
    description: "Brand description",
    example: "Technology company known for innovative products",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: "Brand active status",
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}

export class ReviewBrandDto {
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
