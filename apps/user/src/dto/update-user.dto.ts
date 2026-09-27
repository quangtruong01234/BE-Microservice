import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from "class-validator";

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  declare name?: string;

  @IsOptional()
  @IsEmail()
  declare email?: string;

  // EMAIL-REAUTH-01: verified only when `email` changes, never persisted.
  @IsOptional()
  @IsString()
  declare currentPassword?: string;

  @IsOptional()
  @IsUrl()
  declare avatar?: string;
}
