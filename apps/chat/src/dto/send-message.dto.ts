import { IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";

export class SendMessageDto {
  @IsInt()
  @Min(1)
  declare conversationId: number;

  @IsString()
  @MinLength(1)
  declare content: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  parentMessageId?: number;
}
