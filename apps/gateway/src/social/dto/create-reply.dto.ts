import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { IsPublicId } from "../../common/validators/is-public-id.validator";
import { PUBLIC_ID_PREFIXES } from "libs/constant/public-id.constant";

export class CreateReplyDto {
  @ApiProperty({ description: "Reply content", maxLength: 1000 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  content!: string;

  @ApiProperty({
    description: "Public ID of the post this reply belongs to",
    example: "post_8fK2mQ9xL3pT7vWb",
  })
  @IsString()
  @IsPublicId(PUBLIC_ID_PREFIXES.POST)
  declare postId: string;
}
