import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { User } from './user.entity.js';
import { DuplicateUserFieldError, UsersService } from './users.service.js';

function uniqueViolation(detail: string): QueryFailedError {
  return new QueryFailedError('INSERT ...', [], {
    code: '23505',
    detail,
  } as unknown as Error);
}

describe('UsersService', () => {
  const repository = {
    create: vi.fn((input: Partial<User>) => ({ ...input }) as User),
    save: vi.fn(),
  };
  let users: UsersService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
      ],
    }).compile();

    users = moduleRef.get(UsersService);
  });

  it('saves a new user and returns it', async () => {
    const saved = { id: 'uuid', username: 'alice' } as User;
    repository.save.mockResolvedValue(saved);

    const input = {
      username: 'alice',
      email: 'alice@test.dev',
      passwordHash: 'hash',
    };
    await expect(users.create(input)).resolves.toBe(saved);
    expect(repository.create).toHaveBeenCalledWith(input);
  });

  it.each(['username', 'email'] as const)(
    'reports which field is already taken (%s)',
    async (field) => {
      repository.save.mockRejectedValue(
        uniqueViolation(`Key (${field})=(x) already exists.`),
      );

      const error: unknown = await users
        .create({ username: 'x', email: 'x@test.dev', passwordHash: 'hash' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DuplicateUserFieldError);
      expect((error as DuplicateUserFieldError).field).toBe(field);
    },
  );

  it('reports a username that only differs by case', async () => {
    repository.save.mockRejectedValue(
      uniqueViolation('Key (lower(username::text))=(alice) already exists.'),
    );

    const error: unknown = await users
      .create({ username: 'ALICE', email: null, passwordHash: null })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DuplicateUserFieldError);
    expect((error as DuplicateUserFieldError).field).toBe('username');
  });

  it('rethrows any other database error', async () => {
    const failure = new Error('connection lost');
    repository.save.mockRejectedValue(failure);

    await expect(
      users.create({ username: 'x', email: null, passwordHash: null }),
    ).rejects.toBe(failure);
  });
});
