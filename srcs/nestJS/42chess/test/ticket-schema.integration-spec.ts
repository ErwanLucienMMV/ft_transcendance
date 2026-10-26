import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';
const options = cliDataSource.options;
if (options.type !== 'postgres') throw new Error('PostgreSQL required');
const postgresOptions = options;

describe('DB ticket schema on PostgreSQL', () => {
  const schema = `tickets_${randomUUID().replaceAll('-', '')}`;
  let source: DataSource;
  let alice: string;
  let bob: string;
  beforeAll(async () => {
    source = new DataSource({
      ...postgresOptions,
      schema,
      extra: { max: 1 },
    });
    await source.initialize();
    await source.query(`CREATE SCHEMA "${schema}"`);
    // Migrations use unqualified SQL, as do existing production migrations.
    await source.query(`SET search_path TO "${schema}", public`);
    // A single connection keeps search_path consistent for every query.
    await source.runMigrations();
    [alice, bob] = [randomUUID(), randomUUID()];
    await source.query(
      `INSERT INTO "${schema}".users (id, username, email) VALUES ($1, 'ticket_alice', 'ticket_alice@example.test'), ($2, 'ticket_bob', 'ticket_bob@example.test')`,
      [alice, bob],
    );
  });
  afterAll(async () => {
    if (source?.isInitialized) {
      await source.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await source.destroy();
    }
  });
  const q = (sql: string, args: unknown[] = []) =>
    source.query(sql.replaceAll('@.', `"${schema}".`), args);
  it('DB-01 DB-02 DB-03 DB-04 preserves users, unique names/emails and timestamps', async () => {
    await expect(
      q(`INSERT INTO @.users (username) VALUES ('TICKET_ALICE')`),
    ).rejects.toThrow();
    await expect(
      q(
        `INSERT INTO @.users (username, email) VALUES ('other', 'ticket_alice@example.test')`,
      ),
    ).rejects.toThrow();
    const [user] = await q(
      'SELECT "createdAt", "updatedAt" FROM @.users WHERE id=$1',
      [alice],
    );
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });
  it('DB-05 DB-06 rejects duplicate OAuth identities and missing users', async () => {
    await q(
      `INSERT INTO @.oauth_accounts ("userId", provider, "providerUserId") VALUES ($1, 'github', '42')`,
      [alice],
    );
    await expect(
      q(
        `INSERT INTO @.oauth_accounts ("userId", provider, "providerUserId") VALUES ($1, 'github', '42')`,
        [bob],
      ),
    ).rejects.toThrow();
    await expect(
      q(
        `INSERT INTO @.oauth_accounts ("userId", provider, "providerUserId") VALUES ($1, 'github', '43')`,
        [randomUUID()],
      ),
    ).rejects.toThrow();
  });
  it('DB-12 DB-13 prevents self links and reversed duplicates', async () => {
    await q(
      'INSERT INTO @.friend_requests ("senderId", "recipientId") VALUES ($1,$2)',
      [alice, bob],
    );
    await expect(
      q(
        'INSERT INTO @.friend_requests ("senderId", "recipientId") VALUES ($1,$2)',
        [bob, alice],
      ),
    ).rejects.toThrow();
    const pair = [alice, bob].sort();
    await q(
      'INSERT INTO @.friendships ("userId", "friendId") VALUES ($1,$2)',
      pair,
    );
    await expect(
      q('INSERT INTO @.friendships ("userId", "friendId") VALUES ($1,$2)', [
        alice,
        alice,
      ]),
    ).rejects.toThrow();
  });
  it('DB-14 DB-15 DB-16 enforces content and history references', async () => {
    await expect(
      q(
        'INSERT INTO @.messages ("senderId", "recipientId", content) VALUES ($1,$2, $3)',
        [alice, bob, '  '],
      ),
    ).rejects.toThrow();
    await expect(
      q(
        'INSERT INTO @.game_messages ("gameId", "userId", content) VALUES ($1,$2,$3)',
        [randomUUID(), alice, 'hello'],
      ),
    ).rejects.toThrow();
    await expect(
      q(
        'INSERT INTO @.rating_history ("gameId", "userId", "ratingBefore", "ratingAfter") VALUES ($1,$2,1200,1210)',
        [randomUUID(), alice],
      ),
    ).rejects.toThrow();
  });
  it('DB-17 DB-18 enforces one queue entry per user and creates the lookup index', async () => {
    await q(
      'INSERT INTO @.matchmaking_queue ("userId", rating, "initialTime") VALUES ($1,1200,300000)',
      [alice],
    );
    await expect(
      q(
        'INSERT INTO @.matchmaking_queue ("userId", rating, "initialTime") VALUES ($1,1200,300000)',
        [alice],
      ),
    ).rejects.toThrow();
    const [index] = await source.query(
      'SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname=$2',
      [schema, 'IDX_matchmaking_lookup'],
    );
    expect(index.indexdef).toContain(
      '"initialTime", increment, rating, "createdAt", id',
    );
  });
  it('DB-19 DB-20 DB-21 supports repeated attempts but only one daily puzzle per date', async () => {
    const [{ id }] = await q(
      `INSERT INTO @.puzzles (fen, solution) VALUES ('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1', ARRAY['f7g7']) RETURNING id`,
    );
    await expect(
      q(`INSERT INTO @.puzzles (fen, solution) VALUES ('position', '{}')`),
    ).rejects.toThrow();
    await q(
      `INSERT INTO @.daily_puzzles ("puzzleId", date) VALUES ($1, '2026-10-15')`,
      [id],
    );
    await expect(
      q(
        `INSERT INTO @.daily_puzzles ("puzzleId", date) VALUES ($1, '2026-10-15')`,
        [id],
      ),
    ).rejects.toThrow();
    await q(
      'INSERT INTO @.puzzle_attempts ("userId", "puzzleId") VALUES ($1,$2),($1,$2)',
      [alice, id],
    );
    expect((await q('SELECT * FROM @.puzzle_attempts')).length).toBe(2);
  });
  it('rolls back and reapplies all feature migrations', async () => {
    // Fixture rows live only in this random schema; remove dependencies first.
    await q(
      'TRUNCATE @.puzzle_attempts, @.daily_puzzles, @.puzzles, @.matchmaking_queue, @.friendships, @.friend_requests, @.oauth_accounts',
    );
    const featureCount = source.migrations.filter(
      (migration) =>
        Number((migration.name ?? migration.constructor.name).slice(-13)) >=
        1792000000000,
    ).length;
    for (let index = 0; index < featureCount; index++) {
      await source.undoLastMigration();
    }
    const [row] = await source.query('SELECT to_regclass($1) AS name', [
      `${schema}.oauth_accounts`,
    ]);
    expect(row.name).toBeNull();
    for (const table of ['auth_sessions', 'oauth_flows']) {
      const [removed] = await source.query('SELECT to_regclass($1) AS name', [
        `${schema}.${table}`,
      ]);
      expect(removed.name).toBeNull();
    }
    expect(await source.runMigrations()).toHaveLength(featureCount);
    expect(await source.runMigrations()).toHaveLength(0);
    for (const table of ['auth_sessions', 'oauth_flows']) {
      const [restored] = await source.query('SELECT to_regclass($1) AS name', [
        `${schema}.${table}`,
      ]);
      expect(restored.name).not.toBeNull();
    }
    expect((await q('SELECT id FROM @.users')).length).toBe(2);
  });
});
