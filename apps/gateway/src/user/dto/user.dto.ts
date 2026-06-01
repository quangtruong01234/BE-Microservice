import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from "class-validator";

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

export class UpdateUserGatewayDto {
  @ApiPropertyOptional({ example: "John Doe" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  declare name?: string;

  @ApiPropertyOptional({ example: "john@example.com" })
  @IsOptional()
  @IsEmail()
  declare email?: string;

  @ApiPropertyOptional({ example: "https://example.com/avatar.jpg" })
  @IsOptional()
  @IsUrl()
  declare avatar?: string;
}
