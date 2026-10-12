import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { AuthTokenResponse, AuthUserResponse } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResendVerificationDto } from './dto/resend-verification.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Creates an unverified account and emails its verification link. */
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthUserResponse> {
    return this.auth.register(dto);
  }

  /** `login` is a username or an email. Answers 200 with an access token. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthTokenResponse> {
    return this.auth.login(dto);
  }

  /** Called by the front page the emailed link opens. */
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<AuthUserResponse> {
    return this.auth.verifyEmail(dto.token);
  }

  /** Always 202, whether or not the email has a pending account. */
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  resendVerification(@Body() dto: ResendVerificationDto): Promise<void> {
    return this.auth.resendVerification(dto.email);
  }
}
