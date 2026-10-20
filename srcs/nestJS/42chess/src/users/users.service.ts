import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, QueryFailedError, Repository } from 'typeorm';
import { User } from './user.entity.js';
import type { UserPreferences } from './user-preferences.js';

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

  async requireById(id: string): Promise<User> {
    const user = await this.users.findOneBy({ id });
    if (!user)
      throw new NotFoundException({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    return user;
  }

  async updateProfile(
    id: string,
    input: {
      username?: string;
      avatarUrl?: string | null;
      preferences?: Partial<UserPreferences>;
    },
  ): Promise<User> {
    // Copy only explicitly editable fields; never write the request wholesale.
    const changes: {
      username?: string;
      avatarUrl?: string | null;
      preferences?: () => string;
    } = {};
    if (input.username !== undefined) changes.username = input.username;
    if (input.avatarUrl !== undefined) changes.avatarUrl = input.avatarUrl;
    const preferences: Partial<UserPreferences> = {};
    if (input.preferences?.language !== undefined)
      preferences.language = input.preferences.language;
    if (input.preferences?.theme !== undefined)
      preferences.theme = input.preferences.theme;
    if (input.preferences?.soundEnabled !== undefined)
      preferences.soundEnabled = input.preferences.soundEnabled;
    if (Object.keys(preferences).length)
      changes.preferences = () =>
        '"preferences" || CAST(:preferences AS jsonb)';
    await this.requireById(id);
    try {
      if (Object.keys(changes).length)
        await this.users
          .createQueryBuilder()
          .update()
          .set(changes)
          .where('id = :id', { id })
          .setParameter('preferences', JSON.stringify(preferences))
          .execute();
    } catch (error: unknown) {
      if (duplicateField(error) === 'username')
        throw new ConflictException({
          statusCode: 409,
          code: 'USERNAME_ALREADY_EXISTS',
          message: 'This username is already in use.',
        });
      throw error;
    }
    return this.requireById(id);
  }

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

  /**
   * Finds the account a login form refers to, with its `passwordHash`.
   * Usernames cannot contain "@", so the identifier is unambiguous; both
   * lookups ignore case, like the uniqueness rules.
   */
  findForLogin(login: string): Promise<User | null> {
    const query = this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash');
    if (login.includes('@')) {
      query.where('user.email = :email', { email: login.toLowerCase() });
    } else {
      query.where('LOWER(user.username) = LOWER(:username)', {
        username: login,
      });
    }
    return query.getOne();
  }

  /** Finds a user with its `twoFactorSecret`. */
  findForTwoFactor(id: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.twoFactorSecret')
      .where('user.id = :id', { id })
      .getOne();
  }

  /**
   * Burns the time step of an accepted code and clears the failure count.
   * Returns false when that step (or a later one) was already used, which
   * also stops two concurrent requests from both using the same code.
   */
  async consumeTwoFactorStep(id: string, timeStep: number): Promise<boolean> {
    const result = await this.users
      .createQueryBuilder()
      .update()
      .set({ twoFactorLastTimeStep: timeStep, twoFactorFailedAttempts: 0 })
      .where('id = :id', { id })
      .andWhere(
        '("twoFactorLastTimeStep" IS NULL OR "twoFactorLastTimeStep" < :timeStep)',
        { timeStep },
      )
      .execute();
    return result.affected === 1;
  }

  /**
   * Counts a wrong code. The `maxAttempts`-th one in a row locks the code
   * check until `lockUntil` and restarts the count. Done in one statement so
   * concurrent attempts cannot slip past the limit.
   */
  async recordTwoFactorFailure(
    id: string,
    maxAttempts: number,
    lockUntil: Date,
  ): Promise<void> {
    await this.users
      .createQueryBuilder()
      .update()
      .set({
        twoFactorFailedAttempts: () =>
          `CASE WHEN "twoFactorFailedAttempts" + 1 >= :maxAttempts
             THEN 0 ELSE "twoFactorFailedAttempts" + 1 END`,
        twoFactorLockedUntil: () =>
          `CASE WHEN "twoFactorFailedAttempts" + 1 >= :maxAttempts
             THEN :lockUntil::timestamptz ELSE "twoFactorLockedUntil" END`,
      })
      .where('id = :id', { id })
      .setParameters({ maxAttempts, lockUntil })
      .execute();
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
