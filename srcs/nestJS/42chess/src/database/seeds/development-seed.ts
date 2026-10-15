import type { DataSource } from 'typeorm';
import { hash } from 'argon2';
import { assertFen } from '../../chess/fen.js';
import { puzzleFixtures } from './puzzle-fixtures.js';
import { puzzleMoveUci } from '../../puzzles/puzzle-validation.js';

export function assertDevelopmentSeed(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'development' || env.ALLOW_DEV_SEED !== 'yes') {
    throw new Error(
      'Seed requires NODE_ENV=development and ALLOW_DEV_SEED=yes',
    );
  }
  if (!env.DEV_SEED_PASSWORD || env.DEV_SEED_PASSWORD.length < 12) {
    throw new Error('DEV_SEED_PASSWORD must contain at least 12 characters');
  }
}

export const fixtureIds = {
  alice: 'd0000000-0000-4000-8000-000000000001',
  bob: 'd0000000-0000-4000-8000-000000000002',
  waiting: 'd0000000-0000-4000-8000-000000000003',
  finished: 'd0000000-0000-4000-8000-000000000004',
  whitePuzzle: 'd0000000-0000-4000-8000-000000000005',
  blackPuzzle: 'd0000000-0000-4000-8000-000000000006',
  waitingSeat: 'd0000000-0000-4000-8000-000000000007',
  whiteSeat: 'd0000000-0000-4000-8000-000000000008',
  blackSeat: 'd0000000-0000-4000-8000-000000000009',
};

/** DB-22..25: explicit opt-in; atomic inserts, no updates or deletes. */
export async function seedDevelopment(
  source: DataSource,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  assertDevelopmentSeed(env);
  const passwordHash = await hash(env.DEV_SEED_PASSWORD!);
  await source.transaction(async (manager) => {
    // Serialize reruns; collisions with unrelated data abort the transaction.
    await manager.query('SELECT pg_advisory_xact_lock(20261015, 22)');
    for (const [id, name] of [
      [fixtureIds.alice, 'dev_alice'],
      [fixtureIds.bob, 'dev_bob'],
    ]) {
      const [existing] = await manager.query(
        'SELECT username, email FROM users WHERE id=$1',
        [id],
      );
      if (
        existing &&
        (existing.username !== name ||
          existing.email !== `${name}@example.test`)
      ) {
        throw new Error(
          'Development fixture user ID belongs to another account',
        );
      }
      await manager.query(
        `INSERT INTO users (id, username, email, "passwordHash", "emailVerifiedAt") VALUES ($1,$2,$3,$4,now()) ON CONFLICT (id) DO NOTHING`,
        [id, name, `${name}@example.test`, passwordHash],
      );
    }
    await manager.query(
      `INSERT INTO games (id, status, "initialTime", increment) VALUES ($1,'WAITING',300000,2000) ON CONFLICT (id) DO NOTHING`,
      [fixtureIds.waiting],
    );
    await manager.query(
      `INSERT INTO games (id, status, "initialTime", increment, "startedAt", "finishedAt", result, "endReason") VALUES ($1,'FINISHED',300000,2000,'2026-01-01T12:00:00Z','2026-01-01T12:01:00Z','WHITE_WIN','RESIGNATION') ON CONFLICT (id) DO NOTHING`,
      [fixtureIds.finished],
    );
    for (const [id, game, user, color] of [
      [fixtureIds.waitingSeat, fixtureIds.waiting, fixtureIds.alice, 'WHITE'],
      [fixtureIds.whiteSeat, fixtureIds.finished, fixtureIds.alice, 'WHITE'],
      [fixtureIds.blackSeat, fixtureIds.finished, fixtureIds.bob, 'BLACK'],
    ]) {
      await manager.query(
        `INSERT INTO game_players (id, "gameId", "userId", color) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [id, game, user, color],
      );
    }
    for (const puzzle of puzzleFixtures(fixtureIds)) {
      assertFen(puzzle.fen);
      await manager.query(
        `INSERT INTO puzzles (id, fen, solution, rating, themes, "solutionMoves", "createdAt") VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (id) DO NOTHING`,
        [
          puzzle.id,
          puzzle.fen,
          puzzle.solution.map(puzzleMoveUci),
          puzzle.rating,
          puzzle.themes,
          JSON.stringify(puzzle.solution),
          puzzle.createdAt,
        ],
      );
    }
  });
}
