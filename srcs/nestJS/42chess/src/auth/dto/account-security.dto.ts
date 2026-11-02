import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../../users/email.rules.js';
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './register.dto.js';
import { SECOND_FACTOR_CODE } from './second-factor-code.js';

/** A code from the authenticator app being set up. */
export class EnableTwoFactorDto {
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

/** Proof of the second factor: an authenticator code or a recovery code. */
export class SecondFactorDto {
  @Matches(SECOND_FACTOR_CODE, {
    message: 'code must be 6 digits or a recovery code',
  })
  code: string;
}

export class ForgotPasswordDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;
}

export class ResetPasswordDto {
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'token is invalid' })
  token: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  newPassword: string;
}
