import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';
import {
  fixtureIds,
  seedDevelopment,
} from '../dist/database/seeds/development-seed.js';
import { User } from '../dist/users/user.entity.js';
import { Game } from '../dist/games/game.entity.js';
import { GamePlayer } from '../dist/games/game-player.entity.js';
import { Move } from '../dist/games/move.entity.js';
import { GamesService } from '../dist/games/games.service.js';
import { GameStoreService } from '../dist/games/game-store.service.js';
import { GameRulesService } from '../dist/games/game-rules.service.js';
import { GameAgreementsService } from '../dist/games/game-agreements.service.js';
import { GameClocksService } from '../dist/games/clock/game-clocks.service.js';
import { ChessEngineService } from '../dist/chess/chess-engine.service.js';

const env = {
  NODE_ENV: 'development',
  ALLOW_DEV_SEED: 'yes',
  DEV_SEED_PASSWORD: 'collision-test-password',
};

describe('Development seed game and seat ownership', () => {
  const schema = `seed_ownership_${randomUUID().replaceAll('-', '')}`;
  let source: DataSource;
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
      entities: [User, Game, GamePlayer, Move],
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
    await source.query('TRUNCATE users, games, puzzles CASCADE');
  });
  async function snapshot() {
    const rows: Record<string, unknown[]> = {};
    for (const table of ['users', 'games', 'game_players', 'puzzles']) {
      rows[table] = await source.query(`SELECT * FROM ${table} ORDER BY id`);
    }
    return rows;
  }

  it('does not add Alice to an unrelated WAITING game with a colliding UUID', async () => {
    const user = randomUUID();
    await source.query(
      "INSERT INTO users (id,username) VALUES ($1,'unrelated_owner')",
      [user],
    );
    await source.query(
      'INSERT INTO games (id,"initialTime",increment) VALUES ($1,300000,2000)',
      [fixtureIds.waiting],
    );
    await source.query(
      'INSERT INTO game_players ("gameId","userId",color) VALUES ($1,$2,\'BLACK\')',
      [fixtureIds.waiting, user],
    );
    const before = await snapshot();
    await expect(seedDevelopment(source, env)).rejects.toThrow(
      /fixture|collision/i,
    );
    expect(await snapshot()).toEqual(before);
  });

  it.each(['waiting', 'finished'] as const)(
    'rejects an existing %s fixture UUID without its fixture seats',
    async (kind) => {
      if (kind === 'waiting') {
        await source.query(
          'INSERT INTO games (id,"initialTime",increment) VALUES ($1,300000,2000)',
          [fixtureIds.waiting],
        );
      } else {
        await source.query(
          `INSERT INTO games (id,status,"initialTime",increment,"startedAt","finishedAt",result,"endReason")
        VALUES ($1,'FINISHED',300000,2000,'2026-01-01T12:00:00Z','2026-01-01T12:01:00Z','WHITE_WIN','RESIGNATION')`,
          [fixtureIds.finished],
        );
      }
      const before = await snapshot();
      await expect(seedDevelopment(source, env)).rejects.toThrow(
        /fixture|collision/i,
      );
      expect(await snapshot()).toEqual(before);
    },
  );

  it('rejects a fixture game whose initial settings were replaced', async () => {
    await seedDevelopment(source, env);
    await source.query('UPDATE games SET "initialTime"=60000 WHERE id=$1', [
      fixtureIds.waiting,
    ]);
    const before = await snapshot();
    await expect(seedDevelopment(source, env)).rejects.toThrow(
      /fixture|collision/i,
    );
    expect(await snapshot()).toEqual(before);
  });

  it('rejects a fixture seat UUID belonging to another game and rolls back all inserts', async () => {
    const user = randomUUID(),
      game = randomUUID();
    await source.query(
      "INSERT INTO users (id,username) VALUES ($1,'foreign_seat_owner')",
      [user],
    );
    await source.query(
      'INSERT INTO games (id,"initialTime") VALUES ($1,60000)',
      [game],
    );
    await source.query(
      'INSERT INTO game_players (id,"gameId","userId",color) VALUES ($1,$2,$3,\'WHITE\')',
      [fixtureIds.waitingSeat, game, user],
    );
    const before = await snapshot();
    await expect(seedDevelopment(source, env)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it('rejects a fixture seat reassigned to a different user', async () => {
    await seedDevelopment(source, env);
    await source.query('UPDATE game_players SET "userId"=$1 WHERE id=$2', [
      fixtureIds.bob,
      fixtureIds.waitingSeat,
    ]);
    const before = await snapshot();
    await expect(seedDevelopment(source, env)).rejects.toThrow(
      /fixture|collision/i,
    );
    expect(await snapshot()).toEqual(before);
  });

  it('rejects an extra seat while a fixture game is still WAITING', async () => {
    await seedDevelopment(source, env);
    await source.query(
      'INSERT INTO game_players ("gameId","userId",color) VALUES ($1,$2,\'BLACK\')',
      [fixtureIds.waiting, fixtureIds.bob],
    );
    const before = await snapshot();
    await expect(seedDevelopment(source, env)).rejects.toThrow(
      /fixture|collision/i,
    );
    expect(await snapshot()).toEqual(before);
  });

  it('retains the user UUID ownership guard and rolls back newly inserted games', async () => {
    await source.query(
      "INSERT INTO users (id,username,email) VALUES ($1,'another_account','another@example.test')",
      [fixtureIds.alice],
    );
    const before = await snapshot();
    await expect(seedDevelopment(source, env)).rejects.toThrow(
      /fixture user ID/,
    );
    expect(await snapshot()).toEqual(before);
  });

  it.each(['ACTIVE', 'FINISHED'] as const)(
    'preserves its own waiting fixture after real gameplay reaches %s',
    async (status) => {
      await seedDevelopment(source, env);
      const store = new GameStoreService(source);
      const clocks = new GameClocksService();
      const service = new GamesService(
        store,
        new GameRulesService(new ChessEngineService()),
        new GameAgreementsService(store, clocks),
        clocks,
      );
      await service.join(fixtureIds.bob, fixtureIds.waiting);
      if (status === 'FINISHED')
        await service.resign(fixtureIds.bob, fixtureIds.waiting);
      const before = await snapshot();
      await expect(seedDevelopment(source, env)).resolves.toBeUndefined();
      expect(await snapshot()).toEqual(before);
      expect((await service.get(fixtureIds.waiting)).game.status).toBe(status);
    },
  );

  it('serializes concurrent reruns without duplicate seats or games', async () => {
    await Promise.all([
      seedDevelopment(source, env),
      seedDevelopment(source, env),
    ]);
    expect((await source.query('SELECT id FROM games')).length).toBe(2);
    expect((await source.query('SELECT id FROM game_players')).length).toBe(3);
  });
});
