import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import type { Repository } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';
import { INITIAL_ELO, User } from '../src/users/user.entity.js';

const options = cliDataSource.options;
if (options.type !== 'postgres') {
  throw new Error('Database integration tests require PostgreSQL');
}
const postgresOptions = options;

const UNIQUE_VIOLATION = '23505';

describe('User entity and CreateUsers migration', () => {
  const schema = `users_${randomUUID().replaceAll('-', '')}`;
  let source: DataSource;
  let users: Repository<User>;

  beforeAll(async () => {
    // Create the isolated schema first: the real migrations must run inside it.
    const admin = new DataSource({ ...postgresOptions, migrations: [] });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.destroy();

    source = new DataSource({
      ...postgresOptions,
      schema,
      entities: [User],
      // Generated migrations use unqualified table names: route them to the
      // test schema. `public` stays reachable for shared extensions.
      extra: {
        ...postgresOptions.extra,
        options: `-c search_path=${schema},public`,
      },
    });
    await source.initialize();
    await source.runMigrations();
    users = source.getRepository(User);
  });

  afterAll(async () => {
    if (source?.isInitialized) {
      try {
        await source.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await source.destroy();
      }
    }
  });

  async function expectUniqueViolation(promise: Promise<unknown>) {
    const error: unknown = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueryFailedError);
    expect((error as QueryFailedError & { code: string }).code).toBe(
      UNIQUE_VIOLATION,
    );
  }

  it('applies default values on creation', async () => {
    const user = await users.save(users.create({ username: 'alice' }));

    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user).toMatchObject({
      elo: INITIAL_ELO,
      gamesPlayed: 0,
      gamesWon: 0,
      gamesDraw: 0,
      gamesLost: 0,
    });
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate username', async () => {
    await users.save(users.create({ username: 'bob' }));

    await expectUniqueViolation(users.save(users.create({ username: 'bob' })));
  });

  it('rejects a duplicate email but allows several users without email', async () => {
    await users.save(users.create({ username: 'carol', email: 'c@test.dev' }));
    await expectUniqueViolation(
      users.save(users.create({ username: 'carol2', email: 'c@test.dev' })),
    );

    await users.save(users.create({ username: 'no_mail_1', email: null }));
    await expect(
      users.save(users.create({ username: 'no_mail_2', email: null })),
    ).resolves.toBeDefined();
  });

  it('never selects passwordHash unless explicitly requested', async () => {
    const { id } = await users.save(
      users.create({ username: 'dave', passwordHash: 'hash' }),
    );

    const found = await users.findOneByOrFail({ id });
    expect(found.passwordHash).toBeUndefined();

    const withHash = await users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOneOrFail();
    expect(withHash.passwordHash).toBe('hash');
  });
});
