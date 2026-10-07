import { Transform } from "class-transformer";
import { IsInt, IsString, Length, Min } from "class-validator";
import type { AskProductQuestionPayload } from "@app/common";

export class AskDto implements AskProductQuestionPayload {
  @IsInt()
  @Min(1)
  declare productId: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @Length(3, 300)
  declare question: string;
}
