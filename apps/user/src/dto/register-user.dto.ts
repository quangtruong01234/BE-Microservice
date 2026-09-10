import { IsString, IsNotEmpty, IsEmail } from "class-validator";

export class RegisterUserDto {
  @IsString()
  @IsNotEmpty()
  declare username: string;

  @IsEmail()
  @IsNotEmpty()
  declare email: string;

  @IsString()
  @IsNotEmpty()
  declare password: string;
}
