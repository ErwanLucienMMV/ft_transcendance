import { Matches } from 'class-validator';

/** Body of `POST /v1/auth/verify-email`: the token from the emailed link. */
export class VerifyEmailDto {
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'token is malformed' })
  token: string;
}
