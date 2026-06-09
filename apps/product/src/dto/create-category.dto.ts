import { IsString, IsOptional, IsBoolean } from "class-validator";

export class CreateCategoryDto {
  @IsString()
  declare name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
