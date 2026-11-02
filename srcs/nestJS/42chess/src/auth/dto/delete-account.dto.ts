import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from './register.dto.js';
import { SECOND_FACTOR_CODE } from './second-factor-code.js';

/** Body of `DELETE /v1/users/me`. What is required depends on the account (see the service). */
export class DeleteAccountDto {
  /** The username, typed again. */
  @IsString()
  @MaxLength(32)
  confirmation: string;

  @IsOptional()
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password?: string;

  @IsOptional()
  @Matches(SECOND_FACTOR_CODE, {
    message: 'code must be 6 digits or a recovery code',
  })
  code?: string;
}
