import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { verify } from 'argon2';
import { ChessEngineService } from '../dist/chess/chess-engine.service.js';
import cliDataSource from '../dist/database/data-source.js';
import {
  fixtureIds,
  seedDevelopment,
} from '../dist/database/seeds/development-seed.js';

const env = {
  NODE_ENV: 'development',
  ALLOW_DEV_SEED: 'yes',
  DEV_SEED_PASSWORD: 'test-fixture-password',
};
describe('DB-22 DB-23 DB-24 DB-25 development fixtures', () => {
  const schema = `seed_${randomUUID().replaceAll('-', '')}`;
  let source: DataSource;
  beforeAll(async () => {
    const admin = new DataSource({ ...cliDataSource.options, migrations: [] });
    await admin.initialize();
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
    } finally {
      await admin.destroy();
    }
    source = new DataSource({
      ...cliDataSource.options,
      schema,
      extra: { options: `-c search_path=${schema},public` },
    });
    await source.initialize();
    await source.runMigrations();
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
  it('inserts playable examples and preserves user data and passwords on rerun', async () => {
    await source.query(`INSERT INTO users (username) VALUES ('unrelated')`);
    await seedDevelopment(source, env);
    const [alice] = await source.query('SELECT * FROM users WHERE id=$1', [
      fixtureIds.alice,
    ]);
    expect(await verify(alice.passwordHash, env.DEV_SEED_PASSWORD)).toBe(true);
    expect(alice.emailVerifiedAt).toBeInstanceOf(Date);
    await seedDevelopment(source, {
      ...env,
      DEV_SEED_PASSWORD: 'changed-password-only',
    });
    const [again] = await source.query('SELECT * FROM users WHERE id=$1', [
      fixtureIds.alice,
    ]);
    expect(again.passwordHash).toBe(alice.passwordHash);
    expect((await source.query('SELECT * FROM users')).length).toBe(3);
    expect((await source.query('SELECT * FROM games')).length).toBe(2);
    expect((await source.query('SELECT * FROM game_players')).length).toBe(3);
    const puzzles = await source.query('SELECT * FROM puzzles');
    expect(puzzles.length).toBe(2);
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    const engine = new ChessEngineService();
    for (const puzzle of puzzles) {
      expect((await engine.analyze({ fen: puzzle.fen })).status).toBe(
        'ongoing',
      );
      expect(
        (await engine.analyze({ fen: puzzle.fen, moves: puzzle.solution }))
          .checkmate,
      ).toBe(true);
    }
    expect(
      (await source.query(`SELECT status FROM games ORDER BY status`)).map(
        (x: { status: string }) => x.status,
      ),
    ).toEqual(['FINISHED', 'WAITING']);
  });
  it('aborts all inserts on username collision and preserves the existing account', async () => {
    await source.query(
      'TRUNCATE moves, game_players, games, oauth_accounts, friend_requests, friendships, messages, game_messages, rating_history, matchmaking_queue, puzzle_attempts, users',
    );
    await source.query(`INSERT INTO users (username) VALUES ('dev_bob')`);
    await expect(seedDevelopment(source, env)).rejects.toThrow();
    expect(await source.query('SELECT username FROM users')).toEqual([
      { username: 'dev_bob' },
    ]);
    expect((await source.query('SELECT * FROM games')).length).toBe(0);
  });
});
