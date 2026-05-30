import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";

export class CreateReplyDto {
  @ApiProperty({ description: "Reply content", maxLength: 1000 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  content!: string;

  @ApiProperty({ description: "ID of the post this reply belongs to" })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  postId!: number;
}
