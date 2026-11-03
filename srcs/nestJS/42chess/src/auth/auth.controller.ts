import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AUTH_RATE_LIMIT,
  EMAIL_RATE_LIMIT,
  REGISTER_RATE_LIMIT,
} from '../common/rate-limit.js';
import { AuthService } from './auth.service.js';
import type {
  AuthTokenResponse,
  AuthUserResponse,
  TwoFactorChallengeResponse,
} from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResendVerificationDto } from './dto/resend-verification.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { VerifyTwoFactorDto } from './dto/verify-two-factor.dto.js';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Creates an unverified account and emails its verification link. */
  @Post('register')
  @Throttle(REGISTER_RATE_LIMIT)
  register(@Body() dto: RegisterDto): Promise<AuthUserResponse> {
    return this.auth.register(dto);
  }

  /**
   * `login` is a username or an email. Answers 200 with an access token, or
   * with `{ requires2fa, challengeToken }` for an account with 2FA.
   */
  @Post('login')
  @Throttle(AUTH_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  login(
    @Body() dto: LoginDto,
  ): Promise<AuthTokenResponse | TwoFactorChallengeResponse> {
    return this.auth.login(dto);
  }

  /** Second step of a 2FA login: challenge token + TOTP code. */
  @Post('2fa/verify')
  @Throttle(AUTH_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  verifyTwoFactor(@Body() dto: VerifyTwoFactorDto): Promise<AuthTokenResponse> {
    return this.auth.verifyTwoFactor(dto);
  }

  /** Called by the front page the emailed link opens. */
  @Post('verify-email')
  @Throttle(AUTH_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<AuthUserResponse> {
    return this.auth.verifyEmail(dto.token);
  }

  /** Always 202, whether or not the email has a pending account. */
  @Post('resend-verification')
  @Throttle(EMAIL_RATE_LIMIT)
  @HttpCode(HttpStatus.ACCEPTED)
  resendVerification(@Body() dto: ResendVerificationDto): Promise<void> {
    return this.auth.resendVerification(dto.email);
  }
}
