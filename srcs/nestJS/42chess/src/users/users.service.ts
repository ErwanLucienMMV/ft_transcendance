import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, QueryFailedError, Repository } from 'typeorm';
import { User } from './user.entity.js';

const UNIQUE_VIOLATION = '23505';

export type UniqueUserField = 'username' | 'email';

export interface CreateUserInput {
  username: string;
  email: string | null;
  passwordHash: string | null;
  emailVerifiedAt?: Date | null;
  emailVerificationTokenHash?: string | null;
  emailVerificationExpiresAt?: Date | null;
}

/** Thrown when a username or email is already used by another account. */
export class DuplicateUserFieldError extends Error {
  constructor(readonly field: UniqueUserField) {
    super(`A user with this ${field} already exists`);
    this.name = 'DuplicateUserFieldError';
  }
}

/**
 * Data access for `users`. Kept free of HTTP concerns so that local
 * registration and OAuth can both create accounts through it.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /**
   * Inserts the user directly and relies on the database unique constraints:
   * a "check then insert" would let two concurrent requests both pass.
   */
  async create(input: CreateUserInput): Promise<User> {
    try {
      return await this.users.save(this.users.create(input));
    } catch (error: unknown) {
      const field = duplicateField(error);
      if (field) {
        throw new DuplicateUserFieldError(field);
      }
      throw error;
    }
  }

  /** Accounts whose email was not verified in time give their names back. */
  async deleteExpiredUnverified(now: Date = new Date()): Promise<void> {
    await this.users.delete({
      emailVerifiedAt: IsNull(),
      emailVerificationExpiresAt: LessThan(now),
    });
  }

  findByVerificationTokenHash(tokenHash: string): Promise<User | null> {
    return this.users.findOneBy({ emailVerificationTokenHash: tokenHash });
  }

  findUnverifiedByEmail(email: string): Promise<User | null> {
    return this.users.findOneBy({ email, emailVerifiedAt: IsNull() });
  }

  async setVerificationToken(
    id: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.users.update(id, {
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: expiresAt,
    });
  }

  /** Marks the email verified and burns the token (single use). */
  async markEmailVerified(id: string, at: Date = new Date()): Promise<void> {
    await this.users.update(id, {
      emailVerifiedAt: at,
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
    });
  }

  async delete(id: string): Promise<void> {
    await this.users.delete(id);
  }
}

// PostgreSQL names the indexed key in `detail`, either a column or an
// expression: "Key (email)=(...)" or "Key (lower(username::text))=(...)".
const DUPLICATE_KEY = /^Key \((.+?)\)=\(/;

function duplicateField(error: unknown): UniqueUserField | null {
  if (!(error instanceof QueryFailedError)) {
    return null;
  }
  const { code, detail } = error.driverError as {
    code?: string;
    detail?: string;
  };
  if (code !== UNIQUE_VIOLATION || typeof detail !== 'string') {
    return null;
  }
  const key = DUPLICATE_KEY.exec(detail)?.[1] ?? '';
  if (/\busername\b/.test(key)) {
    return 'username';
  }
  if (/\bemail\b/.test(key)) {
    return 'email';
  }
  return null;
}
