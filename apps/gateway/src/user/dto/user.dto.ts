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
  MaxLength,
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

  // Same floor as reset/change-password. Login stays unconstrained on purpose:
  // accounts created before this floor may hold a shorter password.
  @ApiProperty({ example: "password123", minLength: 6 })
  @IsString()
  @MinLength(6)
  declare password: string;

  // CAPTCHA-01: CaptchaGuard reads and verifies this off the raw body before
  // validation runs; it is declared here only so whitelist validation accepts
  // it. The gateway strips it before the TCP call to the user service.
  @ApiPropertyOptional({
    description:
      "Cloudflare Turnstile token from the storefront widget. Optional until the backend sets CAPTCHA_ENFORCE=true; then a missing or refused token is a 400 with errorCode CAPTCHA_REQUIRED.",
    maxLength: 2048,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  captchaToken?: string;
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

  // CAPTCHA-01: CaptchaGuard reads and verifies this off the raw body before
  // validation runs; it is declared here only so whitelist validation accepts
  // it. The gateway strips it before the TCP call to the user service.
  @ApiPropertyOptional({
    description:
      "Cloudflare Turnstile token from the storefront widget. Optional until the backend sets CAPTCHA_ENFORCE=true; then a missing or refused token is a 400 with errorCode CAPTCHA_REQUIRED.",
    maxLength: 2048,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  captchaToken?: string;
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

  @ApiPropertyOptional({
    description:
      "Search — case-insensitive substring match on username, email or display name. Inactive users are included. Blank means no filter; total/totalPages/hasNext describe the searched set.",
    example: "nguyen",
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  q?: string;
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

  @ApiPropertyOptional({
    example: "john@example.com",
    description:
      "Changing it requires `currentPassword` (EMAIL-REAUTH-01). Re-sending " +
      "the unchanged address does not.",
  })
  @IsOptional()
  @IsEmail()
  declare email?: string;

  // EMAIL-REAUTH-01: the email is where reset codes go, so changing it with a
  // stolen session alone would hand the account over via forgot-password.
  // Only checked by the user service when `email` actually differs.
  @ApiPropertyOptional({
    example: "currentPassword123",
    description:
      "Required only when `email` changes. Missing ⇒ 400; wrong ⇒ 401 with " +
      "errorCode INVALID_CURRENT_PASSWORD. Ignored otherwise.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  declare currentPassword?: string;

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
