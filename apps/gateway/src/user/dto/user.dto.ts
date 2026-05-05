import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString } from "class-validator";

export class RegisterUserDto {
  @ApiProperty({ example: "john_doe" })
  @IsString()
  username: string;

  @ApiProperty({ example: "john@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "password123" })
  @IsString()
  password: string;
}

export class LoginUserDto {
  @ApiProperty({ example: "john_doe" })
  @IsString()
  username: string;

  @ApiProperty({ example: "password123" })
  @IsString()
  password: string;
}
