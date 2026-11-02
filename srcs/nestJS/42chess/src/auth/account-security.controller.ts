import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AUTH_RATE_LIMIT, EMAIL_RATE_LIMIT } from '../common/rate-limit.js';
import { UsersService } from '../users/users.service.js';
import { AccessTokenGuard } from './access-token.guard.js';
import type { AuthenticatedRequest } from './access-token.guard.js';
import { AccountSecurityService } from './account-security.service.js';
import type { TwoFactorSetup } from './account-security.service.js';
import {
  ChangePasswordDto,
  EnableTwoFactorDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  SecondFactorDto,
} from './dto/account-security.dto.js';

@Controller('v1/auth')
export class AccountSecurityController {
  constructor(
    private readonly security: AccountSecurityService,
    private readonly users: UsersService,
  ) {}

  /** What the security settings show: 2FA state, recovery codes left, password or not. */
  @Get('security')
  @UseGuards(AccessTokenGuard)
  async status(@Req() request: AuthenticatedRequest) {
    const user = await this.users.findWithSecrets(request.user.id);
    return {
      hasPassword: !!user?.passwordHash,
      twoFactorEnabled: !!user?.twoFactorEnabledAt,
      recoveryCodesLeft: user?.twoFactorEnabledAt
        ? (user.twoFactorRecoveryCodes?.length ?? 0)
        : null,
    };
  }

  @Post('2fa/setup')
  @UseGuards(AccessTokenGuard)
  @HttpCode(HttpStatus.OK)
  setup(@Req() request: AuthenticatedRequest): Promise<TwoFactorSetup> {
    return this.security.setupTwoFactor(request.user.id);
  }

  @Post('2fa/enable')
  @UseGuards(AccessTokenGuard)
  @Throttle(AUTH_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  enable(
    @Req() request: AuthenticatedRequest,
    @Body() dto: EnableTwoFactorDto,
  ) {
    return this.security.enableTwoFactor(request.user.id, dto.code);
  }

  @Post('2fa/disable')
  @UseGuards(AccessTokenGuard)
  @Throttle(AUTH_RATE_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  disable(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SecondFactorDto,
  ): Promise<void> {
    return this.security.disableTwoFactor(request.user.id, dto.code);
  }

  @Post('2fa/recovery-codes')
  @UseGuards(AccessTokenGuard)
  @Throttle(AUTH_RATE_LIMIT)
  @HttpCode(HttpStatus.OK)
  regenerate(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SecondFactorDto,
  ) {
    return this.security.regenerateRecoveryCodes(request.user.id, dto.code);
  }

  /** Signs out the other sessions of the account. */
  @Post('password')
  @UseGuards(AccessTokenGuard)
  @Throttle(AUTH_RATE_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.security.changePassword(
      request.user.id,
      request.session.sessionId,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  /** Always 202, whether or not the email has an account. */
  @Post('forgot-password')
  @Throttle(EMAIL_RATE_LIMIT)
  @HttpCode(HttpStatus.ACCEPTED)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    return this.security.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @Throttle(AUTH_RATE_LIMIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.security.resetPassword(dto.token, dto.password);
  }
}
