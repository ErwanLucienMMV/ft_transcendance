import type { DataSource, EntityManager } from 'typeorm';
import { hash } from 'argon2';
import { assertFen } from '../../chess/fen.js';
import { puzzleFixtures } from './puzzle-fixtures.js';
import { puzzleMoveUci } from '../../puzzles/puzzle-validation.js';
import { INITIAL_FEN } from '../../games/game.entity.js';

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

const fixtureSeats = [
  [fixtureIds.waitingSeat, fixtureIds.waiting, fixtureIds.alice, 'WHITE'],
  [fixtureIds.whiteSeat, fixtureIds.finished, fixtureIds.alice, 'WHITE'],
  [fixtureIds.blackSeat, fixtureIds.finished, fixtureIds.bob, 'BLACK'],
] as const;

interface ExistingFixtureGame {
  status: string;
  initialTime: number;
  increment: number;
  initialFen: string;
  invitedOpponentId: string | null;
  result: string | null;
  endReason: string | null;
}

interface ExistingFixtureSeat {
  id: string;
  gameId: string;
  userId: string;
  color: string;
}

/** Existing UUIDs are reusable only with their original fixture seats/settings. */
async function assertFixtureGame(
  manager: EntityManager,
  id: string,
): Promise<void> {
  // Match normal game actions' parent-first locking, including concurrent joins.
  const [game] = await manager.query<ExistingFixtureGame[]>(
    'SELECT status, "initialTime", increment, "initialFen", "invitedOpponentId", result, "endReason" FROM games WHERE id=$1 FOR UPDATE',
    [id],
  );
  if (
    !game ||
    game.initialTime !== 300000 ||
    game.increment !== 2000 ||
    game.initialFen !== INITIAL_FEN ||
    game.invitedOpponentId !== null ||
    (id === fixtureIds.finished &&
      (game.status !== 'FINISHED' ||
        game.result !== 'WHITE_WIN' ||
        game.endReason !== 'RESIGNATION'))
  )
    throw new Error(
      'Development fixture game ID has unexpected settings or belongs to another game',
    );

  const seats = await manager.query<ExistingFixtureSeat[]>(
    'SELECT id, "gameId", "userId", color FROM game_players WHERE "gameId"=$1 FOR UPDATE',
    [id],
  );
  const expected = fixtureSeats.filter(([, gameId]) => gameId === id);
  // The waiting fixture may have been joined and played since its first seed.
  const seatCount =
    id === fixtureIds.waiting && game.status === 'WAITING' ? 1 : 2;
  if (
    seats.length !== seatCount ||
    expected.some(
      ([seatId, gameId, userId, color]) =>
        !seats.some(
          (seat) =>
            seat.id === seatId &&
            seat.gameId === gameId &&
            seat.userId === userId &&
            seat.color === color,
        ),
    )
  )
    throw new Error(
      'Development fixture game has missing or conflicting fixture seats',
    );
}

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
    const waiting = await manager.query<{ id: string }[]>(
      `INSERT INTO games (id, status, "initialTime", increment) VALUES ($1,'WAITING',300000,2000) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [fixtureIds.waiting],
    );
    const finished = await manager.query<{ id: string }[]>(
      `INSERT INTO games (id, status, "initialTime", increment, "startedAt", "finishedAt", result, "endReason") VALUES ($1,'FINISHED',300000,2000,'2026-01-01T12:00:00Z','2026-01-01T12:01:00Z','WHITE_WIN','RESIGNATION') ON CONFLICT (id) DO NOTHING RETURNING id`,
      [fixtureIds.finished],
    );
    const created = new Set([...waiting, ...finished].map((game) => game.id));
    // Lock game parents before users, as in normal transactional finalization.
    for (const id of [fixtureIds.waiting, fixtureIds.finished]) {
      if (!created.has(id)) await assertFixtureGame(manager, id);
    }
    for (const [id, name] of [
      [fixtureIds.alice, 'dev_alice'],
      [fixtureIds.bob, 'dev_bob'],
    ]) {
      await manager.query(
        `INSERT INTO users (id, username, email, "passwordHash", "emailVerifiedAt") VALUES ($1,$2,$3,$4,now()) ON CONFLICT (id) DO NOTHING`,
        [id, name, `${name}@example.test`, passwordHash],
      );
      // Check after insertion too: an unrelated concurrent insert must not win
      // an ID race between a preflight lookup and ON CONFLICT DO NOTHING.
      const [existing] = await manager.query(
        'SELECT username, email FROM users WHERE id=$1 FOR UPDATE',
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
    }
    for (const [id, game, user, color] of fixtureSeats) {
      // Never attach or repair seats on a preexisting game. A seat UUID
      // collision on a newly created game must fail and roll back everything.
      if (!created.has(game)) continue;
      await manager.query(
        `INSERT INTO game_players (id, "gameId", "userId", color) VALUES ($1,$2,$3,$4)`,
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
