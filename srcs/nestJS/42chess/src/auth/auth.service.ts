import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MailClient, MailUnavailableError } from '../mail/mail.client.js';
import type { User } from '../users/user.entity.js';
import {
  DuplicateUserFieldError,
  UsersService,
} from '../users/users.service.js';
import type { UniqueUserField } from '../users/users.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { VerifyTwoFactorDto } from './dto/verify-two-factor.dto.js';
import {
  generateVerificationToken,
  hashVerificationToken,
  verificationExpiry,
} from './email-verification-token.js';
import { PasswordService } from './password.service.js';
import { TotpService } from './totp.service.js';
import { TwoFactorChallengeService } from './two-factor-challenge.service.js';
import { SessionService } from './session.service.js';

/** Public part of a user returned by the auth endpoints. */
export interface AuthUser {
  id: string;
  username: string;
  elo: number;
}

export interface AuthUserResponse {
  user: AuthUser;
}

export interface AuthTokenResponse extends AuthUserResponse {
  accessToken: string;
}

/** Login answer for a 2FA account: the code is still to be checked. */
export interface TwoFactorChallengeResponse {
  requires2fa: true;
  challengeToken: string;
}

/** Claims carried by an access token. */
export interface AccessTokenPayload {
  sub: string;
  username: string;
}

// Wrong 2FA codes in a row before the code check is locked, and for how long.
// With 3 codes valid at a time, 5 tries per 15 minutes make guessing hopeless.
export const TWO_FACTOR_MAX_ATTEMPTS = 5;
export const TWO_FACTOR_LOCK_MS = 15 * 60 * 1000;

const CONFLICT_CODES: Record<UniqueUserField, string> = {
  username: 'USERNAME_ALREADY_EXISTS',
  email: 'EMAIL_ALREADY_EXISTS',
};

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly mail: MailClient,
    private readonly jwt: JwtService,
    private readonly totp: TotpService,
    private readonly challenges: TwoFactorChallengeService,
    private readonly sessions: SessionService,
  ) {}

  // Verified when the login matches no password, so that an unknown account
  // takes as long to reject as a wrong password.
  private dummyHash?: Promise<string>;

  /**
   * Creates an unverified account and emails its verification link. The
   * account is deleted if the email cannot be sent: it could never be
   * verified anyway.
   */
  async register(dto: RegisterDto): Promise<AuthUserResponse> {
    const passwordHash = await this.passwords.hash(dto.password);
    await this.users.deleteExpiredUnverified();
    const token = generateVerificationToken();

    const user = await this.createUser({
      username: dto.username,
      email: dto.email,
      passwordHash,
      emailVerificationTokenHash: hashVerificationToken(token),
      emailVerificationExpiresAt: verificationExpiry(),
    });

    try {
      await this.mail.sendEmailVerification(dto.email, user.username, token);
    } catch (error: unknown) {
      await this.users.delete(user.id);
      throw toHttpError(error);
    }
    return toResponse(user);
  }

  /** Consumes a token from an emailed link. Tokens are single use. */
  async verifyEmail(token: string): Promise<AuthUserResponse> {
    const user = await this.users.findByVerificationTokenHash(
      hashVerificationToken(token),
    );
    if (!user) {
      throw invalidVerificationToken();
    }
    const expiresAt = user.emailVerificationExpiresAt;
    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      // Not verified in time: the account is removed (product rule).
      await this.users.delete(user.id);
      throw invalidVerificationToken();
    }

    await this.users.markEmailVerified(user.id);
    return toResponse(user);
  }

  /**
   * Sends a fresh link and restarts the 30-minute window. Answers the same
   * way whether or not the email exists, so it cannot be used to probe
   * which emails have an account.
   */
  async resendVerification(email: string): Promise<void> {
    await this.users.deleteExpiredUnverified();
    const user = await this.users.findUnverifiedByEmail(email);
    if (!user) {
      return;
    }

    const token = generateVerificationToken();
    await this.users.setVerificationToken(
      user.id,
      hashVerificationToken(token),
      verificationExpiry(),
    );
    try {
      await this.mail.sendEmailVerification(email, user.username, token);
    } catch (error: unknown) {
      throw toHttpError(error);
    }
  }

  /**
   * Exchanges a username or email and its password for an access token, or
   * for a 2FA challenge when the account has two-factor authentication.
   * Unknown accounts and wrong passwords get the same answer; whether the
   * email is verified is only revealed to someone who knows the password.
   */
  async login(
    dto: LoginDto,
  ): Promise<AuthTokenResponse | TwoFactorChallengeResponse> {
    const user = await this.users.findForLogin(dto.login);
    if (!user?.passwordHash) {
      // OAuth-only accounts have no password and cannot log in this way.
      await this.passwords.verify(await this.getDummyHash(), dto.password);
      throw invalidCredentials();
    }
    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      throw invalidCredentials();
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email address before logging in',
      });
    }

    if (user.twoFactorEnabledAt) {
      return {
        requires2fa: true,
        challengeToken: await this.challenges.issue(user.id),
      };
    }
    return this.issueAccessToken(user);
  }

  /**
   * Second step of a 2FA login: trades the challenge from `login` and a TOTP
   * code for an access token. Each code works once, and too many wrong codes
   * lock the check for a while.
   */
  async verifyTwoFactor(dto: VerifyTwoFactorDto): Promise<AuthTokenResponse> {
    const userId = await this.challenges.read(dto.challengeToken);
    const user = userId ? await this.users.findForTwoFactor(userId) : null;
    if (!user?.twoFactorEnabledAt || !user.twoFactorSecret) {
      throw invalidChallenge();
    }
    if (user.twoFactorLockedUntil && user.twoFactorLockedUntil > new Date()) {
      throw tooManyTwoFactorAttempts();
    }

    const timeStep = await this.totp.verify(
      user.twoFactorSecret,
      dto.code,
      user.twoFactorLastTimeStep,
    );
    if (timeStep === null) {
      await this.users.recordTwoFactorFailure(
        user.id,
        TWO_FACTOR_MAX_ATTEMPTS,
        new Date(Date.now() + TWO_FACTOR_LOCK_MS),
      );
      throw invalidTwoFactorCode();
    }
    if (!(await this.users.consumeTwoFactorStep(user.id, timeStep))) {
      // Another request used this code in the meantime.
      throw invalidTwoFactorCode();
    }
    return this.issueAccessToken(user);
  }

  private async issueAccessToken(user: User): Promise<AuthTokenResponse> {
    return this.sessions.issue(user);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.passwords.hash('dummy password for timing');
    return this.dummyHash;
  }

  private async createUser(
    input: Parameters<UsersService['create']>[0],
  ): Promise<User> {
    try {
      return await this.users.create(input);
    } catch (error: unknown) {
      if (error instanceof DuplicateUserFieldError) {
        throw new ConflictException({
          statusCode: 409,
          code: CONFLICT_CODES[error.field],
          message: error.message,
        });
      }
      throw error;
    }
  }
}

// Explicit whitelist: the entity itself is never sent to the client.
function toResponse(user: User): AuthUserResponse {
  return { user: { id: user.id, username: user.username, elo: user.elo } };
}

function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid login or password',
  });
}

function invalidChallenge(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'INVALID_2FA_CHALLENGE',
    message: 'This login attempt is invalid or has expired, log in again',
  });
}

function invalidTwoFactorCode(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'INVALID_2FA_CODE',
    message: 'Invalid authentication code',
  });
}

function tooManyTwoFactorAttempts(): HttpException {
  return new HttpException(
    {
      statusCode: 429,
      code: 'TOO_MANY_2FA_ATTEMPTS',
      message: 'Too many wrong codes, try again later',
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

function invalidVerificationToken(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'INVALID_VERIFICATION_TOKEN',
    message: 'This verification link is invalid or has expired',
  });
}

function toHttpError(error: unknown): unknown {
  if (error instanceof MailUnavailableError) {
    return new ServiceUnavailableException({
      statusCode: 503,
      code: 'EMAIL_SERVICE_UNAVAILABLE',
      message: 'The verification email could not be sent, try again later',
    });
  }
  return error;
}
