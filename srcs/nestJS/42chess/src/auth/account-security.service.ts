import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { generateSecret, generateURI } from 'otplib';
import qrcode from 'qrcode-generator';
import { MailClient } from '../mail/mail.client.js';
import { UsersService } from '../users/users.service.js';
import type { User } from '../users/user.entity.js';
import {
  AuthService,
  invalidTwoFactorCode,
  toHttpError,
} from './auth.service.js';
import {
  generateVerificationToken,
  hashVerificationToken,
} from './email-verification-token.js';
import { PasswordService } from './password.service.js';
import { generateRecoveryCodes } from './recovery-codes.js';
import { SessionService } from './session.service.js';
import { TotpService } from './totp.service.js';

/** A password reset link works for half an hour. */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const ISSUER = '42 Chess';

export interface TwoFactorSetup {
  /** Base32 secret, for typing into an app that cannot scan. */
  secret: string;
  otpauthUrl: string;
  /** The otpauth URL as a QR code, an SVG document. */
  qrSvg: string;
}

/**
 * Security settings of a signed-in account: two-factor authentication, password change,
 * and the password reset that works without being signed in.
 */
@Injectable()
export class AccountSecurityService {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly sessions: SessionService,
    private readonly mail: MailClient,
  ) {}

  /** Starts set-up with a new secret; nothing changes until a first code confirms it. */
  async setupTwoFactor(userId: string): Promise<TwoFactorSetup> {
    const user = await this.account(userId);
    if (user.twoFactorEnabledAt) throw twoFactorAlreadyOn();
    const secret = generateSecret();
    await this.users.setPendingTwoFactor(user.id, secret);
    const otpauthUrl = generateURI({
      issuer: ISSUER,
      label: user.username,
      secret,
    });
    const qr = qrcode(0, 'M');
    qr.addData(otpauthUrl);
    qr.make();
    return {
      secret,
      otpauthUrl,
      qrSvg: qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true }),
    };
  }

  /** The first code proves the app holds the secret; the recovery codes are shown once. */
  async enableTwoFactor(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.account(userId);
    if (user.twoFactorEnabledAt) throw twoFactorAlreadyOn();
    const secret = user.twoFactorPendingSecret;
    if (!secret)
      throw new BadRequestException({
        statusCode: 400,
        code: 'TWO_FACTOR_SETUP_REQUIRED',
        message: 'Start the set-up again: no secret is waiting for a code.',
      });
    const timeStep = await this.totp.verify(secret, code, null);
    if (timeStep === null) throw invalidTwoFactorCode();
    const { codes, hashes } = generateRecoveryCodes();
    if (!(await this.users.enableTwoFactor(user.id, secret, timeStep, hashes)))
      throw twoFactorAlreadyOn();
    await this.mail.notify(user.email, user.username, 'two-factor-enabled');
    return { recoveryCodes: codes };
  }

  /** Needs a current code (or a recovery code): a stolen session alone cannot turn it off. */
  async disableTwoFactor(userId: string, code: string): Promise<void> {
    const user = await this.withTwoFactor(userId);
    await this.auth.checkSecondFactor(user, code);
    await this.users.disableTwoFactor(user.id);
    await this.mail.notify(user.email, user.username, 'two-factor-disabled');
  }

  /** Replaces every recovery code, for instance once a few were used. */
  async regenerateRecoveryCodes(
    userId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.withTwoFactor(userId);
    await this.auth.checkSecondFactor(user, code);
    const { codes, hashes } = generateRecoveryCodes();
    await this.users.setRecoveryCodes(user.id, hashes);
    return { recoveryCodes: codes };
  }

  /** Other sessions are signed out; this one stays. */
  async changePassword(
    userId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.account(userId);
    if (
      !user.passwordHash ||
      !(await this.passwords.verify(user.passwordHash, currentPassword))
    )
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'INVALID_PASSWORD',
        message: 'The current password is not correct.',
      });
    await this.users.setPassword(
      user.id,
      await this.passwords.hash(newPassword),
    );
    await this.sessions.revokeAll(user.id, sessionId);
    await this.mail.notify(user.email, user.username, 'password-changed');
  }

  /**
   * Emails a reset link to a verified account with a password. Answers the same way for any
   * email, so it cannot tell which ones have an account.
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findVerifiedByEmail(email);
    if (!user?.passwordHash || !user.email) return;
    const token = generateVerificationToken();
    await this.users.setPasswordResetToken(
      user.id,
      hashVerificationToken(token),
      new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    );
    try {
      await this.mail.sendPasswordReset(user.email, user.username, token);
    } catch (error: unknown) {
      throw toHttpError(
        error,
        'The email could not be sent, try again in a moment.',
      );
    }
  }

  /** A used link is burnt, and every session of the account is signed out. */
  async resetPassword(token: string, password: string): Promise<void> {
    const user = await this.users.consumePasswordResetToken(
      hashVerificationToken(token),
    );
    if (!user)
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_RESET_TOKEN',
        message:
          'This reset link is invalid or has expired. Ask for a new one.',
      });
    await this.users.setPassword(user.id, await this.passwords.hash(password));
    await this.sessions.revokeAll(user.id);
    await this.mail.notify(user.email, user.username, 'password-changed');
  }

  private async account(userId: string): Promise<User> {
    const user = await this.users.findWithSecrets(userId);
    if (!user)
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_REQUIRED',
        message: 'Authentication is required.',
      });
    return user;
  }

  private async withTwoFactor(userId: string): Promise<User> {
    const user = await this.account(userId);
    if (!user.twoFactorEnabledAt)
      throw new ConflictException({
        statusCode: 409,
        code: 'TWO_FACTOR_NOT_ENABLED',
        message: 'Two-factor authentication is off.',
      });
    // Lock state and last time step are read with the secrets.
    return user;
  }
}

function twoFactorAlreadyOn(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    code: 'TWO_FACTOR_ALREADY_ENABLED',
    message: 'Two-factor authentication is already on.',
  });
}
