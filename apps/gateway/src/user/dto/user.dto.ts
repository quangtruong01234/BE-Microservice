import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  MinLength,
} from "class-validator";
import { IsCloudinaryUrl } from "../../common/validators/is-cloudinary-url.validator";

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

  @ApiPropertyOptional({
    example: true,
    description:
      "Remember me — extends the auth session (cookie + JWT) to 7 days instead of the default 5 hours",
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: "john@example.com" })
  @IsEmail()
  declare email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: "john@example.com" })
  @IsEmail()
  declare email: string;

  @ApiProperty({
    example: "123456",
    description: "6-digit verification code sent to the registered email",
  })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: "code must be a 6-digit number" })
  declare code: string;

  @ApiProperty({ example: "newPassword123", minLength: 6 })
  @IsString()
  @MinLength(6)
  declare newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty({
    example: "currentPassword123",
    description: "The password the account is logged in with",
  })
  @IsString()
  @IsNotEmpty()
  declare currentPassword: string;

  @ApiProperty({ example: "newPassword123", minLength: 6 })
  @IsString()
  @MinLength(6)
  declare newPassword: string;
}

export class ListUsersQueryDto {
  @ApiPropertyOptional({ description: "Page number", default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: "Items per page",
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}

export class FeaturedSellersQueryDto {
  @ApiPropertyOptional({
    description: "Max sellers to return",
    default: 5,
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  limit?: number = 5;
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

  @ApiPropertyOptional({
    example:
      "https://res.cloudinary.com/example/image/upload/v1/avatars/20_abc.jpg",
  })
  @IsOptional()
  @IsCloudinaryUrl({ folder: "avatars", media: "image" })
  declare avatar?: string;
}
