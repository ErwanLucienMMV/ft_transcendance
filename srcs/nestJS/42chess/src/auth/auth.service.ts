import { ConflictException, Injectable } from '@nestjs/common';
import {
  DuplicateUserFieldError,
  UsersService,
} from '../users/users.service.js';
import type { UniqueUserField } from '../users/users.service.js';
import type { RegisterDto } from './dto/register.dto.js';
import { PasswordService } from './password.service.js';

/** Public part of a user returned by the auth endpoints. */
export interface AuthUser {
  id: string;
  username: string;
  elo: number;
}

export interface RegisterResponse {
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
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResponse> {
    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const user = await this.users.create({
        username: dto.username,
        email: dto.email,
        passwordHash,
      });
      // Explicit whitelist: the entity itself is never sent to the client.
      return { user: { id: user.id, username: user.username, elo: user.elo } };
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
