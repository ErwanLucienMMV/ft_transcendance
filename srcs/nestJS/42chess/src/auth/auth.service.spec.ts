import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { User } from '../users/user.entity.js';
import {
  DuplicateUserFieldError,
  UsersService,
} from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';

const DTO = {
  username: 'alice',
  email: 'alice@example.com',
  password: 'correct-horse',
};

describe('AuthService.register', () => {
  const users = { create: vi.fn() };
  const passwords = { hash: vi.fn() };
  let auth: AuthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    passwords.hash.mockResolvedValue('$argon2id$hash');
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: PasswordService, useValue: passwords },
      ],
    }).compile();

    auth = moduleRef.get(AuthService);
  });

  it('stores the hash, never the plain password', async () => {
    users.create.mockResolvedValue({
      id: 'uuid',
      username: 'alice',
      elo: 1200,
    } as User);

    await auth.register(DTO);

    expect(passwords.hash).toHaveBeenCalledWith('correct-horse');
    expect(users.create).toHaveBeenCalledWith({
      username: 'alice',
      email: 'alice@example.com',
      passwordHash: '$argon2id$hash',
    });
  });

  it('returns only the public user fields', async () => {
    users.create.mockResolvedValue({
      id: 'uuid',
      username: 'alice',
      elo: 1200,
      email: 'alice@example.com',
      passwordHash: '$argon2id$hash',
    } as User);

    await expect(auth.register(DTO)).resolves.toEqual({
      user: { id: 'uuid', username: 'alice', elo: 1200 },
    });
  });

  it.each([
    ['username', 'USERNAME_ALREADY_EXISTS'],
    ['email', 'EMAIL_ALREADY_EXISTS'],
  ] as const)('maps a duplicate %s to 409 %s', async (field, code) => {
    users.create.mockRejectedValue(new DuplicateUserFieldError(field));

    const error: unknown = await auth
      .register(DTO)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      statusCode: 409,
      code,
    });
  });
});
