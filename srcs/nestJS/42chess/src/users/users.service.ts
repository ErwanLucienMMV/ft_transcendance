import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, QueryFailedError, Repository } from 'typeorm';
import { User } from './user.entity.js';
import type { UserPreferences } from './user-preferences.js';
import type { Pagination } from '../common/types/api.js';

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

  async publicById(
    id: string,
  ): Promise<
    Pick<User, 'id' | 'username' | 'avatarUrl' | 'elo' | 'gamesPlayed'>
  > {
    // An unverified account is not public yet: it may never be confirmed.
    const user = await this.users.findOne({
      where: { id, emailVerifiedAt: Not(IsNull()) },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        elo: true,
        gamesPlayed: true,
      },
    });
    if (!user)
      throw new NotFoundException({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    return user;
  }

  searchByUsername(
    q: string,
    pagination: Pagination = { limit: 20, offset: 0 },
  ): Promise<User[]> {
    return this.users
      .createQueryBuilder('user')
      .select(['user.id', 'user.username', 'user.avatarUrl', 'user.elo'])
      .where('user.username ILIKE :q', {
        q: `%${q.replace(/[\\%_]/g, '\\$&')}%`,
      })
      .andWhere('user.emailVerifiedAt IS NOT NULL')
      .orderBy('LOWER(user.username)', 'ASC')
      .addOrderBy('user.id', 'ASC')
      .take(pagination.limit)
      .skip(pagination.offset)
      .getMany();
  }

  /** Swaps the avatar reference in one statement and returns the replaced one, to delete it. */
  async setAvatar(
    id: string,
    reference: string | null,
  ): Promise<{ user: User; previous: string | null }> {
    // The row lock makes a concurrent upload wait, then read the avatar this one
    // wrote: each replaced file is reported, and removed, exactly once.
    const previous = await this.users.manager.transaction(async (manager) => {
      const [row] = (await manager.query(
        `SELECT "avatarUrl" FROM "users" WHERE "id" = $1 FOR UPDATE`,
        [id],
      )) as { avatarUrl: string | null }[];
      if (!row)
        throw new NotFoundException({
          statusCode: 404,
          code: 'USER_NOT_FOUND',
          message: 'User not found.',
        });
      await manager.query(
        `UPDATE "users" SET "avatarUrl" = $2, "updatedAt" = now() WHERE "id" = $1`,
        [id, reference],
      );
      return row.avatarUrl;
    });
    return { user: await this.requireById(id), previous };
  }

  async updateProfile(
    id: string,
    input: {
      username?: string;
      preferences?: Partial<UserPreferences>;
    },
  ): Promise<User> {
    // Copy only explicitly editable fields; never write the request wholesale.
    const changes: {
      username?: string;
      preferences?: () => string;
    } = {};
    if (input.username !== undefined) changes.username = input.username;
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

  /** Burns one recovery code; false when it is not (or no longer) one of the account's codes. */
  async consumeRecoveryCode(id: string, codeHash: string): Promise<boolean> {
    const result = await this.users
      .createQueryBuilder()
      .update()
      .set({
        twoFactorRecoveryCodes: () =>
          'array_remove("twoFactorRecoveryCodes", :codeHash)',
        twoFactorFailedAttempts: 0,
      })
      .where('id = :id', { id })
      .andWhere(':codeHash = ANY("twoFactorRecoveryCodes")')
      .andWhere('"twoFactorEnabledAt" IS NOT NULL')
      .setParameter('codeHash', codeHash)
      .execute();
    return result.affected === 1;
  }

  /** The account with every secret its security settings need. */
  findWithSecrets(id: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect([
        'user.passwordHash',
        'user.twoFactorSecret',
        'user.twoFactorPendingSecret',
        'user.twoFactorRecoveryCodes',
      ])
      .where('user.id = :id', { id })
      .andWhere('user.deletedAt IS NULL')
      .getOne();
  }

  async setPendingTwoFactor(id: string, secret: string): Promise<void> {
    await this.users.update(
      { id, twoFactorEnabledAt: IsNull() },
      { twoFactorPendingSecret: secret },
    );
  }

  /**
   * Turns 2FA on with the pending secret the first code proved, its time step burnt.
   * False when set-up was restarted or finished meanwhile.
   */
  async enableTwoFactor(
    id: string,
    secret: string,
    timeStep: number,
    recoveryHashes: string[],
  ): Promise<boolean> {
    const result = await this.users
      .createQueryBuilder()
      .update()
      .set({
        twoFactorSecret: secret,
        twoFactorPendingSecret: null,
        twoFactorEnabledAt: () => 'now()',
        twoFactorLastTimeStep: timeStep,
        twoFactorFailedAttempts: 0,
        twoFactorLockedUntil: null,
        twoFactorRecoveryCodes: recoveryHashes,
      })
      .where('id = :id', { id })
      .andWhere('"twoFactorEnabledAt" IS NULL')
      .andWhere('"twoFactorPendingSecret" = :secret', { secret })
      .execute();
    return result.affected === 1;
  }

  async disableTwoFactor(id: string): Promise<void> {
    await this.users.update(id, {
      twoFactorSecret: null,
      twoFactorPendingSecret: null,
      twoFactorEnabledAt: null,
      twoFactorLastTimeStep: null,
      twoFactorFailedAttempts: 0,
      twoFactorLockedUntil: null,
      twoFactorRecoveryCodes: null,
    });
  }

  async setRecoveryCodes(id: string, hashes: string[]): Promise<void> {
    await this.users.update(id, { twoFactorRecoveryCodes: hashes });
  }

  /** A new password also burns any pending reset link. */
  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.users.update(id, {
      passwordHash,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    });
  }

  /** The verified, not deleted account of an email, with its password hash. */
  findVerifiedByEmail(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .andWhere('user.emailVerifiedAt IS NOT NULL')
      .getOne();
  }

  async setPasswordResetToken(
    id: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.users.update(id, {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: expiresAt,
    });
  }

  /**
   * Burns a reset token and returns its account, or null for an unknown or expired one.
   * One statement, so a link cannot be used twice concurrently.
   */
  async consumePasswordResetToken(tokenHash: string): Promise<User | null> {
    const result = await this.users
      .createQueryBuilder()
      .update()
      .set({ passwordResetTokenHash: null, passwordResetExpiresAt: null })
      .where('"passwordResetTokenHash" = :tokenHash', { tokenHash })
      .andWhere('"passwordResetExpiresAt" > now()')
      .andWhere('"emailVerifiedAt" IS NOT NULL')
      .returning(['id'])
      .execute();
    const id = (result.raw as { id: string }[])[0]?.id;
    return id ? this.users.findOneBy({ id }) : null;
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
