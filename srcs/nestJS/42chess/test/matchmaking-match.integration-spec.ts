import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import cliDataSource from '../dist/database/data-source.js';
import { MatchmakingService } from '../dist/matchmaking/matchmaking.service.js';
import {
  MatchmakingEvents,
  MATCH_CHANNEL,
} from '../dist/matchmaking/matchmaking-events.service.js';
import { GamesService } from '../dist/games/games.service.js';
import { GameStoreService } from '../dist/games/game-store.service.js';
import { GameRulesService } from '../dist/games/game-rules.service.js';
import { GameAgreementsService } from '../dist/games/game-agreements.service.js';
import { GameClocksService } from '../dist/games/clock/game-clocks.service.js';
import { ChessEngineService } from '../dist/chess/chess-engine.service.js';
import { PresenceService } from '../dist/presence/presence.service.js';
import { User } from '../dist/users/user.entity.js';
import { Game } from '../dist/games/game.entity.js';
import { GamePlayer } from '../dist/games/game-player.entity.js';
import { Move } from '../dist/games/move.entity.js';
import { RatingHistory } from '../dist/rating/rating-history.entity.js';
import { MatchmakingEntry } from '../dist/matchmaking/matchmaking-queue.entity.js';

// Separate schema and real concurrent PostgreSQL connections; no repository doubles.
describe('MATCH-02..12 atomic queue to game lifecycle', () => {
  const schema = `match_complete_${randomUUID().replaceAll('-', '')}`;
  const control = { initialTime: 300000, increment: 2000 };
  let source: DataSource, service: MatchmakingService, games: GamesService;
  let events: MatchmakingEvents, presence: PresenceService;

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
      entities: [User, Game, GamePlayer, Move, RatingHistory, MatchmakingEntry],
      extra: { ...options.extra, options: `-c search_path=${schema},public` },
    });
    await source.initialize();
    await source.runMigrations();
    const store = new GameStoreService(source),
      clocks = new GameClocksService();
    games = new GamesService(
      store,
      new GameRulesService(new ChessEngineService()),
      new GameAgreementsService(store, clocks),
      clocks,
    );
    service = new MatchmakingService(source, games);
    presence = new PresenceService();
    events = new MatchmakingEvents(source, presence);
    await events.onApplicationBootstrap();
  });
  afterAll(async () => {
    await events?.onApplicationShutdown();
    if (source?.isInitialized) {
      try {
        await source.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await source.destroy();
      }
    }
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await source.query('TRUNCATE users, games CASCADE');
  });

  async function user() {
    const [row]: { id: string }[] = await source.query(
      `INSERT INTO users (username, "emailVerifiedAt") VALUES ($1, now()) RETURNING id`,
      [randomUUID().replaceAll('-', '')],
    );
    return row.id;
  }
  async function pair() {
    const ids = [await user(), await user()];
    for (const id of ids) await service.join(id, control);
    return ids;
  }
  async function count(table: string) {
    const [row]: { count: number }[] = await source.query(
      `SELECT count(*)::int AS count FROM ${table}`,
    );
    return row.count;
  }
  const notify = (payload: unknown) =>
    source.query('SELECT pg_notify($1, $2)', [
      MATCH_CHANNEL,
      JSON.stringify(payload),
    ]);

  it('reports idle status and idempotent effective cancellation', async () => {
    const id = await user();
    expect(await service.status(id)).toEqual({ status: 'IDLE' });
    expect(await service.leave(id)).toEqual({ status: 'IDLE' });
    await service.join(id, control);
    expect(await service.status(id)).toMatchObject({
      status: 'WAITING',
      joinedAt: expect.any(Date),
    });
    expect(await service.leave(id)).toMatchObject({ status: 'CANCELLED' });
    expect(await service.leave(id)).toMatchObject({ status: 'CANCELLED' });
    await service.join(await user(), control);
    expect(await service.matchNext()).toBeNull();
    expect(await count('games')).toBe(0);
  });

  it('creates two seats, running server clock, durable assignment and real waits atomically', async () => {
    const [a, b] = await pair();
    await source.query(
      `UPDATE matchmaking_queue SET "createdAt" = clock_timestamp() - interval '30 seconds' WHERE "userId" = $1`,
      [a],
    );
    const id = await service.matchNext();
    expect(id).toEqual(expect.any(String));
    const state = await games.get(id!);
    expect(state.game).toMatchObject({
      status: 'ACTIVE',
      turn: 'WHITE',
      clock: { status: 'RUNNING', activeColor: 'WHITE' },
      clockDeadline: expect.any(Date),
    });
    expect(new Set(state.players.map((p) => p.userId))).toEqual(
      new Set([a, b]),
    );
    expect(state.players.map((p) => p.color).sort()).toEqual([
      'BLACK',
      'WHITE',
    ]);
    expect(await service.status(a)).toEqual({ status: 'MATCHED', gameId: id });
    expect(await service.leave(a)).toEqual({ status: 'MATCHED', gameId: id });
    await expect(service.join(a, control)).rejects.toMatchObject({
      response: { code: 'ACTIVE_GAME_EXISTS' },
    });
    const [record] = await source.query('SELECT * FROM matchmaking_matches');
    expect(record.gameId).toBe(id);
    expect(record.whiteWaitSeconds).toBeGreaterThanOrEqual(29);
    expect(record.blackWaitSeconds).toBeGreaterThanOrEqual(0);
    expect(
      await source
        .getRepository(MatchmakingEntry)
        .countBy({ status: 'WAITING' }),
    ).toBe(0);
  });

  it('serializes different matching replicas: each of twelve users gets exactly one game', async () => {
    const ids = await Promise.all(Array.from({ length: 12 }, () => user()));
    await Promise.all(ids.map((id) => service.join(id, control)));
    const replica = new MatchmakingService(source, games);
    const found = (
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          (i % 2 ? replica : service).matchNext(),
        ),
      )
    ).filter(Boolean);
    expect(new Set(found).size).toBe(6);
    expect(found).toHaveLength(6);
    expect(await count('games')).toBe(6);
    expect(await count('matchmaking_matches')).toBe(6);
    const seats: { userId: string; count: number }[] = await source.query(
      'SELECT "userId", count(*)::int AS count FROM game_players GROUP BY "userId"',
    );
    expect(seats).toHaveLength(12);
    expect(seats.every((seat) => seat.count === 1)).toBe(true);
  });

  it('an effective cancellation wins before any later matcher', async () => {
    const [a] = await pair();
    await service.leave(a);
    expect(
      await Promise.all([service.matchNext(), service.matchNext()]),
    ).toEqual([null, null]);
    expect(await count('games')).toBe(0);
  });

  it('a concurrent cancellation and match have one coherent winning outcome', async () => {
    const [a] = await pair();
    const [left, gameId] = await Promise.all([
      service.leave(a),
      service.matchNext(),
    ]);
    if (left.status === 'CANCELLED') {
      expect(gameId).toBeNull();
      expect(await count('games')).toBe(0);
    } else {
      expect(left).toEqual({ status: 'MATCHED', gameId });
      expect(await count('games')).toBe(1);
    }
  });

  it('revalidates account eligibility after candidate selection before creating a game', async () => {
    const [a] = await pair();
    const original = games.createMatched.bind(games);
    vi.spyOn(games, 'createMatched').mockImplementationOnce(
      async (manager, white, black, input) => {
        await source.query(
          'UPDATE users SET "emailVerifiedAt" = NULL WHERE id=$1',
          [a],
        );
        return original(manager, white, black, input);
      },
    );
    await expect(service.matchNext()).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
    expect(await count('games')).toBe(0);
    expect(await service.status(a)).toMatchObject({ status: 'WAITING' });
  });

  it('rolls back game, seats and queue when a late durable record write fails; retry succeeds', async () => {
    const [a] = await pair();
    await source.query(
      `CREATE FUNCTION reject_match() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected match record failure'; END $$`,
    );
    await source.query(
      'CREATE TRIGGER reject_match BEFORE INSERT ON matchmaking_matches FOR EACH ROW EXECUTE FUNCTION reject_match()',
    );
    try {
      await expect(service.matchNext()).rejects.toThrow(
        'injected match record failure',
      );
      expect(await count('games')).toBe(0);
      expect(await count('game_players')).toBe(0);
      expect(await count('matchmaking_matches')).toBe(0);
      expect(await service.status(a)).toMatchObject({ status: 'WAITING' });
    } finally {
      await source.query('DROP TRIGGER reject_match ON matchmaking_matches');
      await source.query('DROP FUNCTION reject_match()');
    }
    expect(await service.matchNext()).toEqual(expect.any(String));
  });

  it('sends committed private MATCH_FOUND across the PostgreSQL bridge and skips revoked tabs', async () => {
    const [a, b] = await pair();
    const messages: unknown[] = [],
      invalid = vi.fn();
    const connected = () => true;
    events.connect('valid', {
      userId: a,
      connected,
      validate: async () => {},
      send: (event, data) => messages.push({ event, data }),
    });
    events.connect('revoked', {
      userId: b,
      connected,
      validate: async () => {
        throw new Error('revoked');
      },
      send: invalid,
    });
    const outside = vi.fn();
    events.connect('outside', {
      userId: await user(),
      connected,
      validate: async () => {},
      send: outside,
    });
    try {
      const id = await service.matchNext();
      await vi.waitFor(() => expect(messages).toHaveLength(1));
      expect(messages[0]).toEqual({
        event: 'MATCH_FOUND',
        data: { gameId: id, color: 'WHITE', opponentId: b },
      });
      expect(await games.get(id!)).toMatchObject({
        game: { id, status: 'ACTIVE' },
        players: expect.any(Array),
      });
      expect(invalid).not.toHaveBeenCalled();
      expect(outside).not.toHaveBeenCalled();
    } finally {
      for (const id of ['valid', 'revoked', 'outside']) events.disconnect(id);
    }
  });

  it('never emits a rolled back notification and ignores nonexistent games before a received barrier', async () => {
    const [a, b, c, d] = await Promise.all(
      Array.from({ length: 4 }, () => user()),
    );
    const aborted = await source.transaction((manager) =>
      games.createMatched(manager, a, b, control),
    );
    const barrier = await source.transaction((manager) =>
      games.createMatched(manager, c, d, control),
    );
    const received: { gameId: string }[] = [];
    for (const id of [a, c])
      events.connect(id, {
        userId: id,
        connected: () => true,
        validate: async () => {},
        send: (_event, data) => received.push(data as { gameId: string }),
      });
    try {
      await expect(
        source.transaction(async (manager) => {
          await manager.query('SELECT pg_notify($1, $2)', [
            MATCH_CHANNEL,
            JSON.stringify({
              gameId: aborted.game.id,
              whiteId: a,
              blackId: b,
            }),
          ]);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      await notify({ gameId: randomUUID(), whiteId: a, blackId: b });
      await notify({ gameId: barrier.game.id, whiteId: c, blackId: d });
      // Receive a real valid event on this same bridge: earlier notifications have
      // been processed in order before asserting absence of the aborted event.
      await vi.waitFor(() =>
        expect(received.some((event) => event.gameId === barrier.game.id)).toBe(
          true,
        ),
      );
      await events.flush();
      expect(received.map((event) => event.gameId)).toEqual([barrier.game.id]);
    } finally {
      for (const id of [a, c]) events.disconnect(id);
    }
  });

  it('keeps exact matched assignment after game completion and clears it on a new queue cycle', async () => {
    const [a] = await pair();
    const first = await service.matchNext();
    await games.resign(a, first!);
    // A later unrelated game must never replace the completed matching assignment.
    await source.query('INSERT INTO games ("initialTime") VALUES (60000)');
    expect(await service.status(a)).toEqual({
      status: 'MATCHED',
      gameId: first,
    });
    await service.join(a, control);
    const row = await source
      .getRepository(MatchmakingEntry)
      .findOneByOrFail({ userId: a });
    expect(row).toMatchObject({
      status: 'WAITING',
      matchedGameId: null,
      matchedAt: null,
    });
    expect(await count('matchmaking_matches')).toBe(1);
  });

  it('handles foreign-key deletion and migration down/up without changing other feature tables', async () => {
    const [a] = await pair();
    const game = await service.matchNext();
    await source.query('DELETE FROM game_players WHERE "gameId"=$1', [game]);
    await source.query('DELETE FROM games WHERE id=$1', [game]);
    expect(await service.status(a)).toEqual({ status: 'MATCHED' });
    expect(await count('matchmaking_matches')).toBe(0);
    await source.undoLastMigration();
    expect(await source.runMigrations()).toHaveLength(1);
    expect(await count('users')).toBe(2);
  });
});
