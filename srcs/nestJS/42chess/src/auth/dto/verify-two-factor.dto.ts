import { IsJWT, Matches } from 'class-validator';

/** Body of `POST /v1/auth/2fa/verify`: second step of a 2FA login. */
export class VerifyTwoFactorDto {
  /** Returned by `POST /v1/auth/login` when the account has 2FA enabled. */
  @IsJWT()
  challengeToken: string;

  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}
