import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';
import { GamesService } from '../dist/games/games.service.js';
import { GameRulesService } from '../dist/games/game-rules.service.js';
import { GameStoreService } from '../dist/games/game-store.service.js';
import { GameAgreementsService } from '../dist/games/game-agreements.service.js';
import { GameClocksService } from '../dist/games/clock/game-clocks.service.js';
import { ChessEngineService } from '../dist/chess/chess-engine.service.js';
import { User } from '../dist/users/user.entity.js';
import { Game } from '../dist/games/game.entity.js';
import { GamePlayer } from '../dist/games/game-player.entity.js';
import { Move } from '../dist/games/move.entity.js';

export const INITIAL_FEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const AFTER_E4 =
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

/** Real PostgreSQL and C++ rules service; no chess-rule or repository doubles. */
export function gameFixture() {
  const schema = `lifecycle_${randomUUID().replaceAll('-', '')}`;
  let source: DataSource;
  let service: GamesService;
  const engine = new ChessEngineService();
  let white: string;
  let black: string;
  let outsider: string;

  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
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
    service = new GamesService(
      new GameStoreService(source),
      new GameRulesService(engine),
      new GameAgreementsService(
        new GameStoreService(source),
        new GameClocksService(),
      ),
      new GameClocksService(),
    );
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
    await source.query('TRUNCATE "moves", "game_players", "games", "users"');
    const rows = await source.query(`INSERT INTO "users" ("username")
      VALUES ('white_player'), ('black_player'), ('outsider') RETURNING "id"`);
    [white, black, outsider] = rows.map((row: { id: string }) => row.id);
  });

  return {
    get source() {
      return source;
    },
    get service() {
      return service;
    },
    get white() {
      return white;
    },
    get black() {
      return black;
    },
    get outsider() {
      return outsider;
    },
    engine,
    async active(initialFen?: string) {
      const state = await service.create(white, {
        initialTime: 300000,
        increment: 2000,
        initialFen,
      });
      return service.join(black, state.game.id);
    },
    async playLine(id: string, moves: string[]) {
      for (const uci of moves) {
        const state = await service.get(id);
        const player = state.players.find(
          (player) => player.color === state.game.turn,
        )!;
        await service.play(player.userId, id, uci);
      }
      return service.get(id);
    },
    async count(table: 'games' | 'game_players' | 'moves') {
      const [row] = await source.query(
        `SELECT count(*)::int AS count FROM "${table}"`,
      );
      return row.count as number;
    },
  };
}
