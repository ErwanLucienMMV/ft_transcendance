import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import cliSource from '../dist/database/data-source.js';
import { ChessEngineService } from '../dist/chess/chess-engine.service.js';
import { PuzzleRulesService } from '../dist/puzzles/puzzle-rules.service.js';
import { PuzzlesService } from '../dist/puzzles/puzzles.service.js';
import { PuzzleAttempt } from '../dist/puzzles/puzzle-attempts.entity.js';
import { DailyPuzzle } from '../dist/puzzles/daily-puzzles.entity.js';
import { User } from '../dist/users/user.entity.js';
import { AuthSession } from '../dist/auth/auth-session.entity.js';
import { Puzzle } from '../dist/puzzles/puzzles.entity.js';
import { importPuzzles } from '../dist/puzzles/puzzle-import.js';

export async function createPuzzleFixture() {
  process.env.CHESS_ENGINE_URL =
    process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
  const options = cliSource.options;
  if (options.type !== 'postgres') throw new Error('PostgreSQL is required');
  const schema = `puzzle_${randomUUID().replaceAll('-', '')}`;
  const admin = new DataSource({ ...options, migrations: [] });
  await admin.initialize();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await admin.destroy();
  }
  const source = new DataSource({
    ...options,
    schema,
    entities: [User, AuthSession, Puzzle, PuzzleAttempt, DailyPuzzle],
    extra: {
      ...options.extra,
      application_name: schema,
      options: `-c search_path=${schema},public -c timezone=Pacific/Kiritimati`,
    },
  });
  await source.initialize();
  await source.runMigrations();
  const engine = new ChessEngineService();
  const rules = new PuzzleRulesService(engine);
  const service = new PuzzlesService(source, rules);
  const users: { id: string }[] =
    await source.query(`INSERT INTO users (username, "emailVerifiedAt")
    VALUES ('puzzle_alice', now()), ('puzzle_bob', now()) RETURNING id`);
  return {
    source,
    rules,
    engine,
    service,
    schema,
    alice: users[0].id,
    bob: users[1].id,
    async load() {
      return importPuzzles(source, rules, 'data/puzzles/lichess-sample.csv');
    },
    async reference() {
      return source
        .getRepository(Puzzle)
        .findOneByOrFail({ sourceId: 'lichess:00sHx' });
    },
    async composed(
      fen: string,
      solution: string[],
      themes: Puzzle['themes'] = [],
    ) {
      await rules.validate(fen, solution);
      return source
        .getRepository(Puzzle)
        .save({ fen, solution, themes, rating: 800, validatedAt: new Date() });
    },
    async clear() {
      await source.query('TRUNCATE puzzle_attempts, daily_puzzles, puzzles');
    },
    async close() {
      if (source.isInitialized) {
        await source.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await source.destroy();
      }
    },
  };
}
