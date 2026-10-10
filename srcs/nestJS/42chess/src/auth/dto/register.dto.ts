import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import { IsNotReservedUsername } from '../../users/username.rules.js';
import { IsNotDisposableEmail } from '../../users/email.rules.js';

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
// Upper bound so a huge body cannot make Argon2 burn CPU and memory.
export const PASSWORD_MAX_LENGTH = 128;

/** Body of `POST /v1/auth/register`. Bounds match the `users` columns. */
export class RegisterDto {
  @IsString()
  @Length(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH)
  @Matches(/^[A-Za-z0-9_]+$/, {
    message: 'username may only contain letters, digits and underscores',
  })
  @Matches(/^[A-Za-z0-9_]+$/, {
    message: 'username may only contain letters, digits and underscores',
  })
  @IsNotReservedUsername()
  username: string;

  // Stored lowercase so that "Alice@x.io" and "alice@x.io" are one account.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  // Options are spelled out on purpose: they are the accepted format.
  // ASCII-only local part, because many mail servers reject accented ones.
  @IsEmail({
    allow_display_name: false,
    allow_utf8_local_part: false,
    allow_ip_domain: false,
    require_tld: true,
  })
  @MaxLength(EMAIL_MAX_LENGTH)
  @IsNotDisposableEmail()
  email: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password: string;
}
