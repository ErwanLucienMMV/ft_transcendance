import { IsJWT, Matches } from 'class-validator';
import { SECOND_FACTOR_CODE } from './second-factor-code.js';

/** Body of `POST /v1/auth/2fa/verify`: second step of a 2FA login. */
export class VerifyTwoFactorDto {
  /** Returned by `POST /v1/auth/login` when the account has 2FA enabled. */
  @IsJWT()
  challengeToken: string;

  /** A 6-digit authenticator code, or one of the recovery codes ("ab3de-fg5hj"). */
  @Matches(SECOND_FACTOR_CODE, {
    message: 'code must be 6 digits or a recovery code',
  })
  code: string;
}
