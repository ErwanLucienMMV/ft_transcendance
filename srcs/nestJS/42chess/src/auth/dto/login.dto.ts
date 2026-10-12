import { IsString, Length } from 'class-validator';
import { EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH } from './register.dto.js';

/**
 * Body of `POST /v1/auth/login`. `login` is a username or an email. Only the
 * upper bounds are enforced: the format rules belong to registration, and a
 * stricter check here would tell apart "malformed" from "wrong credentials".
 */
export class LoginDto {
  @IsString()
  @Length(1, EMAIL_MAX_LENGTH)
  login: string;

  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;
}
