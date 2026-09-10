import { IsString, IsNotEmpty } from "class-validator";

export class LoginUserDto {
  @IsString()
  @IsNotEmpty()
  declare username: string;

  @IsString()
  @IsNotEmpty()
  declare password: string;
}
