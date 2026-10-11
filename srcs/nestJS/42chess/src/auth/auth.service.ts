import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MailClient, MailUnavailableError } from '../mail/mail.client.js';
import type { User } from '../users/user.entity.js';
import {
  DuplicateUserFieldError,
  UsersService,
} from '../users/users.service.js';
import type { UniqueUserField } from '../users/users.service.js';
import type { RegisterDto } from './dto/register.dto.js';
import {
  generateVerificationToken,
  hashVerificationToken,
  verificationExpiry,
} from './email-verification-token.js';
import { PasswordService } from './password.service.js';

/** Public part of a user returned by the auth endpoints. */
export interface AuthUser {
  id: string;
  username: string;
  elo: number;
}

export interface AuthUserResponse {
  user: AuthUser;
}

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
  ) {}

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
