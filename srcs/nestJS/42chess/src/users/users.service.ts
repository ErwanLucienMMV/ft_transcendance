import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { User } from './user.entity.js';

const UNIQUE_VIOLATION = '23505';

export type UniqueUserField = 'username' | 'email';

export interface CreateUserInput {
  username: string;
  email: string | null;
  passwordHash: string | null;
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
}

// PostgreSQL reports the column in `detail`: "Key (email)=(...) already exists."
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
  if (detail.startsWith('Key (username)=')) {
    return 'username';
  }
  if (detail.startsWith('Key (email)=')) {
    return 'email';
  }
  return null;
}
