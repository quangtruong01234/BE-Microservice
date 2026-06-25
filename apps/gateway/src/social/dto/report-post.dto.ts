import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class ReportPostDto {
  @ApiProperty({ description: "Reason for reporting the post", maxLength: 500 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  declare reason: string;
}
