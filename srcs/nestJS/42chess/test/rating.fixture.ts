import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';
import { Game } from '../dist/games/game.entity.js';
import type { GameResult } from '../dist/games/game.entity.js';
import { GamePlayer } from '../dist/games/game-player.entity.js';
import { Move } from '../dist/games/move.entity.js';
import { User } from '../dist/users/user.entity.js';
import { RatingHistory } from '../dist/rating/rating-history.entity.js';
import { RatingService } from '../dist/rating/rating.service.js';

/** A private migrated PostgreSQL schema, never the application database. */
export function ratingFixture() {
  const schema = `rating_${randomUUID().replaceAll('-', '')}`;
  let source: DataSource;
  const ratings = new RatingService();
  beforeAll(async () => {
    const options = cliDataSource.options;
    if (options.type !== 'postgres') throw new Error('PostgreSQL required');
    const admin = new DataSource({ ...options, migrations: [] });
    await admin.initialize();
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
    } finally {
      await admin.destroy();
    }
    source = new DataSource({
      ...options,
      schema,
      entities: [User, Game, GamePlayer, Move, RatingHistory],
      extra: { ...options.extra, options: `-c search_path=${schema},public` },
    });
    await source.initialize();
    await source.runMigrations();
  });
  afterAll(async () => {
    if (source?.isInitialized) {
      try {
        await source.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await source.destroy();
      }
    }
  });
  beforeEach(async () => {
    // Only tables in this fixture's private schema and their dependent rows.
    await source.query('TRUNCATE users, games CASCADE');
  });
  async function users(ratingA = 1200, ratingB = 1200) {
    return source.getRepository(User).save([
      source.manager.create(User, {
        username: `w_${randomUUID().slice(0, 8)}`,
        elo: ratingA,
        emailVerifiedAt: new Date(),
      }),
      source.manager.create(User, {
        username: `b_${randomUUID().slice(0, 8)}`,
        elo: ratingB,
        emailVerifiedAt: new Date(),
      }),
    ]);
  }
  async function finished(
    white: User,
    black: User,
    result: GameResult = 'WHITE_WIN',
    initialFen?: string,
  ) {
    const game = await source.manager.save(
      Game,
      source.manager.create(Game, {
        initialTime: 300000,
        increment: 0,
        status: 'FINISHED',
        result,
        endReason: result === 'DRAW' ? 'DRAW_AGREEMENT' : 'RESIGNATION',
        startedAt: new Date('2026-01-01T00:00:00Z'),
        finishedAt: new Date('2026-01-01T00:01:00Z'),
        ...(initialFen === undefined ? {} : { initialFen }),
      }),
    );
    const players = await source.manager.save(GamePlayer, [
      source.manager.create(GamePlayer, {
        gameId: game.id,
        userId: white.id,
        color: 'WHITE',
      }),
      source.manager.create(GamePlayer, {
        gameId: game.id,
        userId: black.id,
        color: 'BLACK',
      }),
    ]);
    return { game, players };
  }
  return {
    get source() {
      return source;
    },
    ratings,
    users,
    finished,
    apply(state: { game: Game; players: GamePlayer[] }) {
      return source.transaction((manager) =>
        ratings.applyFinishedGame(manager, state.game, state.players),
      );
    },
    async snapshot() {
      return {
        users: await source.manager.find(User, { order: { id: 'ASC' } }),
        history: await source.manager.find(RatingHistory, {
          order: { userId: 'ASC', gameId: 'ASC' },
        }),
      };
    },
  };
}
