import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
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
import { ASSIGNABLE_USER_ROLES, UserRole } from "../user.types";

export class RegisterUserDto {
  // NAME-TRIM-01: `username` is the label the whole app falls back to when the
  // display name is null, so a blank one leaves an account with nothing to
  // render anywhere. `@IsString()` alone accepted "" and "   " — the user
  // service DTO does carry `@IsNotEmpty()`, but its ValidationPipe is disabled
  // (`apps/user/src/main.ts`), so this is the only gate that actually runs.
  // Trimming also keeps `" john "` from becoming a row that is UNIQUE against
  // `john` yet renders identically to it.
  @ApiProperty({ example: "john_doe", minLength: 1 })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsNotEmpty()
  declare username: string;

  @ApiProperty({ example: "john@example.com" })
  @IsEmail()
  declare email: string;

  @ApiProperty({ example: "password123" })
  @IsString()
  declare password: string;
}

export class LoginUserDto {
  @ApiProperty({ example: "john_doe" })
  @IsString()
  declare username: string;

  @ApiProperty({ example: "password123" })
  @IsString()
  declare password: string;

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

export class SearchUsersQueryDto {
  @ApiProperty({
    description:
      "Keyword matched against `username` and the display `name`. " +
      "Case- and accent-insensitive: `quang` matches `Quảng`.",
    example: "techstore",
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  declare q: string;

  @ApiPropertyOptional({
    description: "Max users to return",
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
  // NAME-TRIM-01: `@MinLength(1)` alone accepts `"   "` (length 3), which is
  // then stored verbatim and leaves every label for that account rendering
  // blank. Trimming runs in `plainToInstance` BEFORE validation, so a
  // whitespace-only name collapses to `""` and is rejected with a 400 — and a
  // padded `" John "` is persisted as `"John"`.
  @ApiPropertyOptional({
    example: "John Doe",
    minLength: 1,
    description:
      "Display name. Trimmed before validation — whitespace-only is a 400, " +
      "not a stored blank. `null` clears the name.",
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
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

export class UpdateUserRoleDto {
  @ApiProperty({
    example: "shop",
    enum: ASSIGNABLE_USER_ROLES,
    description: "Role name to assign. Must exist and be active in `roles`.",
  })
  @IsIn(ASSIGNABLE_USER_ROLES)
  declare role: UserRole["rol_name"];
}
