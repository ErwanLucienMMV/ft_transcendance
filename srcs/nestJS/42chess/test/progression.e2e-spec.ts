import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import WebSocket from 'ws';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { SessionService } from '../dist/auth/session.service.js';
import { GamesService } from '../dist/games/games.service.js';
import { ProgressionService } from '../dist/progression/progression.service.js';

interface Packet {
  event: string;
  data: Record<string, unknown>;
}

// XP, levels and achievements from finished games, the public statistics of a profile
// and the leaderboard, with the live events that announce them.
describe('Progression from finished games', () => {
  let app: INestApplication, source: DataSource, games: GamesService;
  let progression: ProgressionService, url: string;
  const users: User[] = [];
  const tokens = new Map<string, string>();
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.listen(0, '127.0.0.1');
    source = app.get(DataSource);
    games = app.get(GamesService);
    progression = app.get(ProgressionService);
    url = (await app.getUrl()).replace('http:', 'ws:') + '/ws';
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
  });

  afterAll(async () => {
    if (source?.isInitialized && users.length) {
      const ids = users.map((user) => user.id);
      const owned = `SELECT "gameId" FROM game_players WHERE "userId" = ANY($1)`;
      await source.query(
        `DELETE FROM rating_history WHERE "gameId" IN (${owned})`,
        [ids],
      );
      await source.query(`DELETE FROM games WHERE id IN (${owned})`, [ids]);
      await source.getRepository(User).delete(ids);
    }
    await app?.close();
  });

  async function player(xp = 0): Promise<User> {
    const saved = await source.getRepository(User).save({
      username: `xp_${randomUUID().slice(0, 12)}`,
      emailVerifiedAt: new Date(),
    });
    users.push(saved);
    tokens.set(
      saved.id,
      (await app.get(SessionService).issue(saved)).accessToken,
    );
    if (xp)
      await source.query(
        `INSERT INTO user_progress ("userId", xp) VALUES ($1, $2)`,
        [saved.id, xp],
      );
    return saved;
  }

  async function listen(user: User): Promise<Packet[]> {
    const socket = new WebSocket(url);
    sockets.push(socket);
    const packets: Packet[] = [];
    socket.on('message', (raw: Buffer) =>
      packets.push(JSON.parse(raw.toString('utf8')) as Packet),
    );
    await once(socket, 'open');
    socket.send(
      JSON.stringify({
        event: 'AUTHENTICATE',
        data: { accessToken: tokens.get(user.id) },
      }),
    );
    await vi.waitFor(() =>
      expect(packets.map((packet) => packet.event)).toContain('AUTHENTICATED'),
    );
    return packets;
  }

  async function game(white: User, black: User, rated = true) {
    const state = await games.create(white.id, {
      initialTime: 300000,
      increment: 0,
      color: 'WHITE',
      rated,
    });
    await games.join(black.id, state.game.id);
    return state.game.id;
  }

  /** Fool's mate: black wins after four plies. */
  async function foolsMate(white: User, black: User, rated = true) {
    const id = await game(white, black, rated);
    for (const [actor, move] of [
      [white.id, 'f2f3'],
      [black.id, 'e7e5'],
      [white.id, 'g2g4'],
      [black.id, 'd8h4'],
    ])
      await games.play(actor, id, move);
    return id;
  }

  const http = () => request(app.getHttpServer());
  const stats = async (user: User) =>
    (await http().get(`/v1/users/${user.id}/stats`).expect(200)).body;
  const achievements = async (user: User) =>
    (await http().get(`/v1/users/${user.id}/achievements`).expect(200)).body
      .achievements as {
      code: string;
      progress: number;
      goal: number;
      unlockedAt: string | null;
    }[];

  it('awards XP to both players, unlocks achievements and announces a new level', async () => {
    const white = await player();
    const black = await player(90);
    const packets = await listen(black);
    const id = await foolsMate(white, black);

    // Black: 90 + 30 for the win, then 10 + 20 for "Opening move" and "First victory".
    expect((await stats(black)).progression).toEqual({
      xp: 150,
      level: 2,
      levelXp: 100,
      nextLevelXp: 300,
    });
    // White: 10 for the loss, then 10 for "Opening move".
    expect((await stats(white)).progression.xp).toBe(20);
    const unlocked = (await achievements(black)).filter(
      (item) => item.unlockedAt,
    );
    expect(
      unlocked.map((item) => item.code).sort((a, b) => a.localeCompare(b)),
    ).toEqual(['FIRST_GAME', 'FIRST_WIN']);
    expect(
      (await achievements(black)).find((item) => item.code === 'GAMES_10'),
    ).toMatchObject({ progress: 1, goal: 10, unlockedAt: null });
    await vi.waitFor(() => {
      expect(
        packets
          .filter((packet) => packet.event === 'ACHIEVEMENT_UNLOCKED')
          .map((packet) => String(packet.data.code))
          .sort((a, b) => a.localeCompare(b)),
      ).toEqual(['FIRST_GAME', 'FIRST_WIN']);
      expect(
        packets.find((packet) => packet.event === 'LEVEL_UP')?.data,
      ).toEqual({ level: 2, xp: 150 });
    });

    // Finishing logic run twice never pays twice.
    await source.transaction((manager) => progression.awardGame(manager, id));
    expect((await stats(black)).progression.xp).toBe(150);
  });

  it('tells both players what a rated game changed in their Elo', async () => {
    const white = await player();
    const black = await player();
    const rated = await foolsMate(white, black);
    const casual = await foolsMate(white, black, false);
    const { body } = await http().get(`/v1/games/${rated}`).expect(200);
    const history: {
      userId: string;
      ratingBefore: number;
      ratingAfter: number;
    }[] = await source.query(
      'SELECT "userId", "ratingBefore", "ratingAfter" FROM rating_history WHERE "gameId" = $1',
      [rated],
    );
    const change = (id: string) => {
      const row = history.find((entry) => entry.userId === id)!;
      return row.ratingAfter - row.ratingBefore;
    };
    expect(body.ratingChanges).toEqual({
      white: change(white.id),
      black: change(black.id),
    });
    expect(body.ratingChanges.black).toBeGreaterThan(0);
    expect(body.ratingChanges.white).toBeLessThan(0);
    expect(
      (await http().get(`/v1/games/${casual}`).expect(200)).body.ratingChanges,
    ).toBeNull();
  });

  it('shows rated, casual and computer results with the rank of the player', async () => {
    const white = await player();
    const black = await player();
    await foolsMate(white, black);
    await foolsMate(white, black, false);
    const body = await stats(black);
    expect(body.rated).toEqual({ played: 1, won: 1, drawn: 0, lost: 0 });
    expect(body.casual).toEqual({ played: 1, won: 1, drawn: 0, lost: 0 });
    expect(body.bots).toEqual({ played: 0, won: 0, drawn: 0, lost: 0 });
    expect((await stats(white)).casual).toEqual({
      played: 1,
      won: 0,
      drawn: 0,
      lost: 1,
    });
    const { elo } = await source
      .getRepository(User)
      .findOneByOrFail({ id: black.id });
    const [{ above }] = (await source.query(
      `SELECT count(*)::int AS above FROM users
       WHERE "emailVerifiedAt" IS NOT NULL AND "gamesPlayed" > 0 AND elo > $1`,
      [elo],
    )) as { above: number }[];
    expect(body.rank).toBe(above + 1);
    expect(body.rankedPlayers).toBeGreaterThanOrEqual(2);
    // No rated game yet: no rank.
    expect((await stats(await player())).rank).toBeNull();
  });

  it('pays nothing for a game resigned before two moves each', async () => {
    const white = await player();
    const black = await player();
    const id = await game(white, black);
    await games.play(white.id, id, 'e2e4');
    await games.resign(black.id, id);
    expect((await stats(white)).progression.xp).toBe(0);
    expect(
      (await achievements(white)).every((item) => item.unlockedAt === null),
    ).toBe(true);
  });

  it('counts a win against the hard computer apart and unlocks its achievement', async () => {
    const user = await player();
    const [{ id }] = (await source.query(
      `INSERT INTO games (status, "initialTime", rated, "startedAt", "finishedAt", result, "endReason")
       VALUES ('FINISHED', 300000, false, now() - interval '1 minute', now(), 'WHITE_WIN', 'CHECKMATE') RETURNING id`,
    )) as { id: string }[];
    await source.query(
      `INSERT INTO game_players ("gameId", "userId", "botDifficulty", color)
       VALUES ($1, $2, NULL, 'WHITE'), ($1, NULL, 'HARD', 'BLACK')`,
      [id, user.id],
    );
    for (const [ply, uci] of ['e2e4', 'e7e5', 'g1f3', 'b8c6'].entries())
      await source.query(
        `INSERT INTO moves ("gameId", color, ply, uci, "fenAfter") VALUES ($1, $2, $3, $4, 'fen')`,
        [id, ply % 2 ? 'BLACK' : 'WHITE', ply + 1, uci],
      );
    const changes = await source.transaction((manager) =>
      progression.awardGame(manager, id),
    );
    await progression.settle(changes);
    const body = await stats(user);
    expect(body.bots).toEqual({ played: 1, won: 1, drawn: 0, lost: 0 });
    expect(body.rated.played).toBe(0);
    // 40 for the win, then 50 for "Machine slayer".
    expect(body.progression.xp).toBe(90);
    expect(
      (await achievements(user)).find((item) => item.code === 'BOT_HARD')
        ?.unlockedAt,
    ).toEqual(expect.any(String));
  });

  it('ranks verified players with a rated game, best rating first', async () => {
    const white = await player();
    const black = await player();
    await foolsMate(white, black);
    const board = (
      await http().get('/v1/leaderboard').query({ limit: 100 }).expect(200)
    ).body as {
      total: number;
      items: { id: string; rank: number; elo: number; level: number }[];
    };
    expect(board.total).toBeGreaterThanOrEqual(2);
    for (const [index, row] of board.items.entries()) {
      if (index === 0) continue;
      expect(row.elo).toBeLessThanOrEqual(board.items[index - 1].elo);
      expect(row.rank).toBeGreaterThanOrEqual(board.items[index - 1].rank);
    }
    const winner = board.items.find((row) => row.id === black.id);
    const loser = board.items.find((row) => row.id === white.id);
    if (winner && loser) expect(winner.rank).toBeLessThan(loser.rank);
    expect(Object.keys(board.items[0]).sort()).toEqual([
      'avatarUrl',
      'elo',
      'gamesDraw',
      'gamesLost',
      'gamesPlayed',
      'gamesWon',
      'id',
      'level',
      'rank',
      'username',
    ]);
    await http().get('/v1/leaderboard').query({ limit: 101 }).expect(400);
  });

  it('serves the rules and the achievement catalogue', async () => {
    const body = (await http().get('/v1/progression/rules').expect(200)).body;
    expect(body.xp.game).toEqual({ win: 30, draw: 15, loss: 10 });
    expect(body.levels[1]).toEqual({ level: 2, xp: 100 });
    expect(body.achievements).toHaveLength(14);
    expect(body.achievements[0]).toEqual({
      code: 'FIRST_GAME',
      name: 'Opening move',
      description: 'Finish your first game against another player.',
      goal: 1,
      xp: 10,
    });
  });

  it('answers 404 for an unknown or unverified player', async () => {
    await http().get(`/v1/users/${randomUUID()}/stats`).expect(404);
    const hidden = await source.getRepository(User).save({
      username: `xp_${randomUUID().slice(0, 12)}`,
    });
    users.push(hidden);
    await http().get(`/v1/users/${hidden.id}/achievements`).expect(404);
    await http().get('/v1/users/not-an-id/stats').expect(400);
  });
});
