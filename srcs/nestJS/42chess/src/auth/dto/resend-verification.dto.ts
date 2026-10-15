import { IsEmail, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../../users/email.rules.js';
import { EMAIL_MAX_LENGTH } from './register.dto.js';

/** Body of `POST /v1/auth/resend-verification`. */
export class ResendVerificationDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;
}
