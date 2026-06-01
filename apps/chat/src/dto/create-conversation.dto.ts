import { IsInt, Min } from "class-validator";

export class CreateConversationDto {
  @IsInt()
  @Min(1)
  declare otherUserId: number;
}
