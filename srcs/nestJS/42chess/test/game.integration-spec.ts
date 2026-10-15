import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';

const options = cliDataSource.options;
if (options.type !== 'postgres') {
  throw new Error('Database integration tests require PostgreSQL');
}
const postgresOptions = options;
const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN_AFTER_E4 =
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

describe('Game persistence migrations', () => {
  const schema = `games_${randomUUID().replaceAll('-', '')}`;
  let source: DataSource;

  beforeAll(async () => {
    const admin = new DataSource({ ...postgresOptions, migrations: [] });
    await admin.initialize();
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
    } finally {
      await admin.destroy();
    }

    source = new DataSource({
      ...postgresOptions,
      schema,
      extra: {
        ...postgresOptions.extra,
        options: `-c search_path=${schema},public`,
      },
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

  beforeEach(async () => {
    await source.query(`TRUNCATE "moves", "game_players", "games"`);
  });

  async function createGame() {
    const [game] = await source.query(
      `INSERT INTO "games" ("initialTime", "increment") VALUES (300000, 2000) RETURNING *`,
    );
    return game as { id: string };
  }

  async function createUser() {
    const [user] = await source.query(
      `INSERT INTO "users" ("username") VALUES ($1) RETURNING "id"`,
      [`g_${randomUUID().replaceAll('-', '').slice(0, 24)}`],
    );
    return (user as { id: string }).id;
  }

  async function addPlayer(gameId: string, userId: string, color: string) {
    return source.query(
      `INSERT INTO "game_players" ("gameId", "userId", "color") VALUES ($1, $2, $3)`,
      [gameId, userId, color],
    );
  }

  async function addMove(
    gameId: string,
    color = 'WHITE',
    ply = 1,
    uci = 'e2e4',
  ) {
    return source.query(
      `INSERT INTO "moves" ("gameId", "color", "ply", "uci", "fenAfter") VALUES ($1, $2, $3, $4, $5)`,
      [gameId, color, ply, uci, FEN_AFTER_E4],
    );
  }

  async function expectViolation(promise: Promise<unknown>, code: string) {
    await expect(promise).rejects.toMatchObject({ driverError: { code } });
  }

  it('creates all three game tables in the isolated schema', async () => {
    const rows = await source.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_name IN ('games', 'game_players', 'moves')
       ORDER BY table_name`,
      [schema],
    );
    expect(rows).toEqual([
      { table_name: 'game_players' },
      { table_name: 'games' },
      { table_name: 'moves' },
    ]);
  });

  it('starts a game with the standard position and no result', async () => {
    const { id } = await createGame();
    const [game] = await source.query(`SELECT * FROM "games" WHERE "id" = $1`, [
      id,
    ]);
    expect(game).toMatchObject({
      status: 'WAITING',
      initialFen: INITIAL_FEN,
      currentFen: INITIAL_FEN,
      turn: 'WHITE',
      initialTime: 300000,
      increment: 2000,
      result: null,
      startedAt: null,
      finishedAt: null,
    });
    expect(game.createdAt).toBeInstanceOf(Date);
  });

  it.each([
    ['"initialTime" = 0'],
    ['"initialTime" = -1'],
    ['"increment" = -1'],
    ['"status" = \'UNKNOWN\''],
    ['"turn" = \'GREEN\''],
    ['"initialFen" = \' \''],
    ['"currentFen" = \'\''],
    ['"result" = \'DRAW\''],
    ['"status" = \'ACTIVE\''],
    ['"status" = \'FINISHED\', "startedAt" = now(), "finishedAt" = now()'],
    [
      '"status" = \'FINISHED\', "startedAt" = now(), "finishedAt" = now(), "result" = \'INVALID\'',
    ],
    [
      '"status" = \'FINISHED\', "startedAt" = now(), "finishedAt" = now() - interval \'1 second\', "result" = \'DRAW\'',
    ],
  ])('rejects an inconsistent game: %s', async (assignment) => {
    const { id } = await createGame();
    await expectViolation(
      source.query(`UPDATE "games" SET ${assignment} WHERE "id" = $1`, [id]),
      '23514',
    );
  });

  it.each(['WHITE_WIN', 'BLACK_WIN', 'DRAW'])(
    'stores a finished result: %s',
    async (result) => {
      const { id } = await createGame();
      await source.query(
        `UPDATE "games" SET "status" = 'ACTIVE', "startedAt" = now() WHERE "id" = $1`,
        [id],
      );
      await source.query(
        `UPDATE "games" SET "status" = 'FINISHED', "finishedAt" = now(), "result" = $2 WHERE "id" = $1`,
        [id, result],
      );
      const [game] = await source.query(
        `SELECT "status", "result" FROM "games" WHERE "id" = $1`,
        [id],
      );
      expect(game).toEqual({ status: 'FINISHED', result });
    },
  );

  it('allows one player of each color and rejects a third player', async () => {
    const { id } = await createGame();
    await addPlayer(id, await createUser(), 'WHITE');
    await addPlayer(id, await createUser(), 'BLACK');
    await expectViolation(addPlayer(id, await createUser(), 'WHITE'), '23505');
    const [row] = await source.query(
      `SELECT count(*)::int AS count FROM "game_players" WHERE "gameId" = $1`,
      [id],
    );
    expect(row.count).toBe(2);
  });

  it('rejects the same user occupying both colors', async () => {
    const { id } = await createGame();
    const user = await createUser();
    await addPlayer(id, user, 'WHITE');
    await expectViolation(addPlayer(id, user, 'BLACK'), '23505');
  });

  it('rejects an invalid player color', async () => {
    const { id } = await createGame();
    await expectViolation(addPlayer(id, await createUser(), 'GREEN'), '23514');
  });

  it('rejects a player referencing a missing user or game', async () => {
    const { id } = await createGame();
    await expectViolation(addPlayer(id, randomUUID(), 'WHITE'), '23503');
    await expectViolation(
      addPlayer(randomUUID(), await createUser(), 'WHITE'),
      '23503',
    );
  });

  it('allows only one concurrent claim for the same color', async () => {
    const { id } = await createGame();
    const users = [await createUser(), await createUser()];
    const attempts = await Promise.allSettled(
      users.map((user) => addPlayer(id, user, 'WHITE')),
    );
    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1);
    const failed = attempts.find((attempt) => attempt.status === 'rejected');
    expect(failed).toMatchObject({
      reason: { driverError: { code: '23505' } },
    });
  });

  it('keeps existing games when an unrelated user is deleted', async () => {
    const { id } = await createGame();
    const player = await createUser();
    await addPlayer(id, player, 'WHITE');
    await expectViolation(
      source.query(`DELETE FROM "users" WHERE "id" = $1`, [player]),
      '23503',
    );
    const unrelated = await createUser();
    await source.query(`DELETE FROM "users" WHERE "id" = $1`, [unrelated]);
    const [game] = await source.query(
      `SELECT "id" FROM "games" WHERE "id" = $1`,
      [id],
    );
    expect(game.id).toBe(id);
  });

  it('ties a move to a player seated in that same game', async () => {
    const first = await createGame();
    const second = await createGame();
    await addPlayer(first.id, await createUser(), 'WHITE');
    await expectViolation(addMove(second.id), '23503');
    await expectViolation(addMove(first.id, 'BLACK'), '23503');
    await addMove(first.id);
  });

  it('rejects a duplicate ply within a game', async () => {
    const { id } = await createGame();
    await addPlayer(id, await createUser(), 'WHITE');
    await addMove(id);
    await expectViolation(addMove(id), '23505');
  });

  it.each(['e2e9', 'E2E4', 'e2e2', 'a7a8k', 'abc'])(
    'rejects malformed UCI notation: %s',
    async (uci) => {
      const { id } = await createGame();
      await addPlayer(id, await createUser(), 'WHITE');
      await expectViolation(addMove(id, 'WHITE', 1, uci), '23514');
    },
  );

  it('rejects a non-positive ply and an empty move snapshot', async () => {
    const { id } = await createGame();
    await addPlayer(id, await createUser(), 'WHITE');
    await expectViolation(addMove(id, 'WHITE', 0), '23514');
    await addMove(id);
    await expectViolation(
      source.query(`UPDATE "moves" SET "fenAfter" = ' ' WHERE "gameId" = $1`, [
        id,
      ]),
      '23514',
    );
  });

  it('deletes game children without deleting its users', async () => {
    const { id } = await createGame();
    const user = await createUser();
    await addPlayer(id, user, 'WHITE');
    await addMove(id);
    await expectViolation(
      source.query(`DELETE FROM "game_players" WHERE "gameId" = $1`, [id]),
      '23503',
    );
    await source.query(`DELETE FROM "games" WHERE "id" = $1`, [id]);
    for (const table of ['game_players', 'moves']) {
      const [row] = await source.query(
        `SELECT count(*)::int AS count FROM "${table}" WHERE "gameId" = $1`,
        [id],
      );
      expect(row.count).toBe(0);
    }
    const [row] = await source.query(
      `SELECT "id" FROM "users" WHERE "id" = $1`,
      [user],
    );
    expect(row.id).toBe(user);
  });

  it('maps games, players and moves for repository persistence', async () => {
    expect(source.hasMetadata('Game')).toBe(true);
    expect(source.hasMetadata('GamePlayer')).toBe(true);
    expect(source.hasMetadata('Move')).toBe(true);
    const games = source.getRepository('Game');
    const game = await games.save(
      games.create({ initialTime: 300000, increment: 2000 }),
    );
    const userId = await createUser();
    const players = source.getRepository('GamePlayer');
    const player = await players.save(
      players.create({ gameId: game.id, userId, color: 'WHITE' }),
    );
    const moves = source.getRepository('Move');
    const move = await moves.save(
      moves.create({
        gameId: game.id,
        color: 'WHITE',
        ply: 1,
        uci: 'e2e4',
        fenAfter: FEN_AFTER_E4,
      }),
    );
    const found = await moves.findOneOrFail({
      where: { id: move.id },
      relations: { game: true, player: { user: true } },
    });
    expect(found).toMatchObject({
      uci: 'e2e4',
      ply: 1,
      fenAfter: FEN_AFTER_E4,
      game: { id: game.id, status: 'WAITING', initialFen: INITIAL_FEN },
      player: { id: player.id, color: 'WHITE', user: { id: userId } },
    });
    const initialFen =
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
    const imported = await games.save(
      games.create({
        initialTime: 60000,
        initialFen,
        currentFen: initialFen,
        turn: 'BLACK',
      }),
    );
    expect(await games.findOneByOrFail({ id: imported.id })).toMatchObject({
      initialFen,
      currentFen: initialFen,
      turn: 'BLACK',
      increment: 0,
    });
  });

  it('indexes game listings, user history and ordered moves', async () => {
    const rows = await source.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1`,
      [schema],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          indexname: 'IDX_games_status_createdAt',
          indexdef: expect.stringContaining('(status, "createdAt", id)'),
        }),
        expect.objectContaining({
          indexname: 'IDX_games_createdAt',
          indexdef: expect.stringContaining('("createdAt", id)'),
        }),
        expect.objectContaining({
          indexname: 'IDX_game_players_userId',
          indexdef: expect.stringContaining('("userId", "gameId")'),
        }),
        expect.objectContaining({
          indexname: 'UQ_moves_ply',
          indexdef: expect.stringContaining('("gameId", ply)'),
        }),
      ]),
    );
  });

  it('rolls back only the game tables and can reapply the migration', async () => {
    const userId = await createUser();
    const { id } = await createGame();
    await addPlayer(id, userId, 'WHITE');
    await addMove(id);
    // Later game feature migrations must be reverted before CreateGames itself.
    const applied: { name: string }[] = await source.query(
      'SELECT "name" FROM "typeorm_migrations" ORDER BY "timestamp" DESC',
    );
    const gameMigrations =
      applied.findIndex((m) => m.name.startsWith('CreateGames')) + 1;
    expect(gameMigrations).toBeGreaterThan(0);
    for (let index = 0; index < gameMigrations; index++)
      await source.undoLastMigration();
    const [row] = await source.query(
      `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('games', 'game_players', 'moves')`,
      [schema],
    );
    expect(row.count).toBe(0);
    const [user] = await source.query(
      `SELECT "id" FROM "users" WHERE "id" = $1`,
      [userId],
    );
    expect(user.id).toBe(userId);
    expect(await source.runMigrations()).toHaveLength(gameMigrations);
    // Also verify a single feature migration can be rolled back and reapplied.
    await source.undoLastMigration();
    expect(await source.runMigrations()).toHaveLength(1);
    expect(await source.runMigrations()).toHaveLength(0);
    const fresh = await createGame();
    await addPlayer(fresh.id, userId, 'WHITE');
    await addMove(fresh.id);
  });
});
