import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  declare rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  declare comment: string | undefined;
}
