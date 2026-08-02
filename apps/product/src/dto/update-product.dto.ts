import { PartialType } from "@nestjs/mapped-types";
import { IsInt, IsOptional, Min } from "class-validator";
import { Type } from "class-transformer";
import { CreateProductDto } from "./create-product.dto";

export class UpdateProductDto extends PartialType(CreateProductDto) {
  // Optimistic concurrency token read from the product being edited. When sent,
  // a mismatch means someone else saved first and the edit is rejected (409).
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  version?: number;
}
