import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import WebSocket from 'ws';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { SessionService } from '../dist/auth/session.service.js';
import { GamesService } from '../dist/games/games.service.js';
import { MatchmakingWorker } from '../dist/matchmaking/matchmaking-worker.service.js';
import { createValidationPipe } from '../dist/common/validation.js';

interface Packet {
  event: string;
  data: Record<string, unknown>;
}

/** Independent QA: production HTTP, revocable sessions, sockets and PostgreSQL. */
describe('SCRUM-450/470 matchmaking workflow', () => {
  let app: INestApplication<App>;
  let source: DataSource;
  let url: string;
  let users: User[];
  let tokens: string[];
  const sockets: WebSocket[] = [];
  const control = { initialTime: 300000, increment: 2000 };

  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    process.env.BOT_ENGINE_URL =
      process.env.TEST_BOT_ENGINE_URL ?? 'ws://127.0.0.1:55434';
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.listen(0, '127.0.0.1');
    source = app.get(DataSource);
    url = (await app.getUrl()).replace('http:', 'ws:') + '/ws';
  });

  beforeEach(async () => {
    const suffix = randomUUID().slice(0, 8);
    users = await source.getRepository(User).save(
      Array.from({ length: 7 }, (_, index) => ({
        username: `matchqa_${suffix}_${index}`,
        emailVerifiedAt: new Date(),
        elo: 1500,
      })),
    );
    tokens = await Promise.all(
      users.map(
        async (user) => (await app.get(SessionService).issue(user)).accessToken,
      ),
    );
  });

  afterEach(async () => {
    await Promise.all(
      sockets.splice(0).map(async (socket) => {
        if (socket.readyState === WebSocket.CLOSED) return;
        const closed = once(socket, 'close');
        socket.terminate();
        await closed;
      }),
    );
    if (!users?.length || !source?.isInitialized) return;
    const ids = users.map((user) => user.id);
    await source.query(
      'DELETE FROM matchmaking_queue WHERE "userId" = ANY($1::uuid[])',
      [ids],
    );
    await source.query(
      'DELETE FROM rating_history WHERE "gameId" IN (SELECT "gameId" FROM game_players WHERE "userId" = ANY($1::uuid[]))',
      [ids],
    );
    await source.query(
      'DELETE FROM games WHERE id IN (SELECT "gameId" FROM game_players WHERE "userId" = ANY($1::uuid[]))',
      [ids],
    );
    await source.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  });
  afterAll(async () => {
    await app?.close();
  });

  function join(index: number, timeControl = control) {
    return request(app.getHttpServer())
      .post('/v1/matchmaking/join')
      .auth(tokens[index], { type: 'bearer' })
      .send({ timeControl });
  }

  async function connect(index: number) {
    const socket = new WebSocket(url);
    sockets.push(socket);
    const packets: Packet[] = [];
    socket.on('message', (raw) => {
      const bytes = Buffer.isBuffer(raw)
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.from(raw);
      packets.push(JSON.parse(bytes.toString('utf8')));
    });
    const take = async (event: string) => {
      let found = -1;
      await vi.waitFor(
        () => {
          found = packets.findIndex((packet) => packet.event === event);
          expect(
            found,
            `Expected ${event}, received ${packets.map((p) => p.event).join(', ')}`,
          ).toBeGreaterThanOrEqual(0);
        },
        { timeout: 5000, interval: 20 },
      );
      return packets.splice(found, 1)[0];
    };
    await once(socket, 'open');
    socket.send(
      JSON.stringify({
        event: 'AUTHENTICATE',
        data: { accessToken: tokens[index] },
      }),
    );
    await take('AUTHENTICATED');
    return { socket, packets, take };
  }

  async function activeSeats() {
    return source.query(
      `SELECT p."userId", p."gameId", p.color FROM game_players p
       JOIN games g ON g.id = p."gameId"
       WHERE p."userId" = ANY($1::uuid[]) AND g.status = 'ACTIVE'`,
      [users.map((user) => user.id)],
    ) as Promise<{ userId: string; gameId: string; color: string }[]>;
  }

  it('rejects anonymous queue entry and forged actor fields without writing a row', async () => {
    await request(app.getHttpServer())
      .post('/v1/matchmaking/join')
      .send({ timeControl: control })
      .expect(401);
    await request(app.getHttpServer())
      .post('/v1/matchmaking/join')
      .auth(tokens[0], { type: 'bearer' })
      .send({ userId: users[1].id, timeControl: control })
      .expect(400);
    const [row] = await source.query(
      'SELECT count(*)::int AS count FROM matchmaking_queue WHERE "userId" = ANY($1::uuid[])',
      [users.map((user) => user.id)],
    );
    expect(row.count).toBe(0);
  });

  it('notifies both authenticated players with a committed active game and no duplicate seats', async () => {
    const [first, second] = await Promise.all([connect(0), connect(1)]);
    const outsider = await connect(6);
    await Promise.all([join(0).expect(201), join(1).expect(201)]);
    const [a, b] = await Promise.all([
      first.take('MATCH_FOUND'),
      second.take('MATCH_FOUND'),
    ]);
    expect(a.data.gameId).toEqual(b.data.gameId);
    expect(a.data.gameId).toEqual(expect.any(String));
    expect(a.data.opponentId).toBe(users[1].id);
    expect(b.data.opponentId).toBe(users[0].id);
    expect(
      outsider.packets.some((packet) => packet.event === 'MATCH_FOUND'),
    ).toBe(false);
    const [game] = await source.query(
      'SELECT status FROM games WHERE id = $1',
      [a.data.gameId],
    );
    expect(game.status).toBe('ACTIVE');
    const seats = await activeSeats();
    expect(seats).toHaveLength(2);
    expect(new Set(seats.map((seat) => seat.userId))).toEqual(
      new Set(users.slice(0, 2).map((u) => u.id)),
    );
    expect(new Set(seats.map((seat) => seat.color))).toEqual(
      new Set(['WHITE', 'BLACK']),
    );
    await join(0).expect(409);
    expect(await activeSeats()).toHaveLength(2);
    const rows = await source.query(
      'SELECT status FROM matchmaking_queue WHERE "userId" = ANY($1::uuid[])',
      [users.slice(0, 2).map((u) => u.id)],
    );
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row: { status: string }) => row.status === 'MATCHED'),
    ).toBe(true);
    await app.get(MatchmakingWorker).tick();
    const journal = await source.query(
      'SELECT "whiteWaitSeconds", "blackWaitSeconds" FROM matchmaking_matches WHERE "gameId" = $1',
      [a.data.gameId],
    );
    expect(journal).toHaveLength(1);
    expect(journal[0].whiteWaitSeconds).toBeGreaterThanOrEqual(0);
    expect(journal[0].blackWaitSeconds).toBeGreaterThanOrEqual(0);
    expect(first.packets.some((packet) => packet.event === 'MATCH_FOUND')).toBe(
      false,
    );
    expect(
      second.packets.some((packet) => packet.event === 'MATCH_FOUND'),
    ).toBe(false);
  });

  it('pairs six simultaneous arrivals into three games without reusing a player', async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, index) => join(index).expect(201)),
    );
    await vi.waitFor(async () => expect(await activeSeats()).toHaveLength(6), {
      timeout: 5000,
      interval: 20,
    });
    const seats = await activeSeats();
    expect(new Set(seats.map((seat) => seat.userId)).size).toBe(6);
    expect(new Set(seats.map((seat) => seat.gameId)).size).toBe(3);
    for (const id of new Set(seats.map((seat) => seat.gameId)))
      expect(seats.filter((seat) => seat.gameId === id)).toHaveLength(2);
  });

  it('keeps an effective cancellation out of later matches and notifications', async () => {
    const cancelled = await connect(0);
    const waiting = await join(0).expect(201);
    expect(waiting.body.status).toBe('WAITING');
    const left = await request(app.getHttpServer())
      .post('/v1/matchmaking/leave')
      .auth(tokens[0], { type: 'bearer' })
      .expect(200);
    expect(left.body.status).toBe('CANCELLED');
    const recipient = await connect(1);
    await join(1).expect(201);
    await app.get(MatchmakingWorker).tick();
    expect(await activeSeats()).toHaveLength(0);
    await join(2).expect(201);
    await recipient.take('MATCH_FOUND');
    const seats = await activeSeats();
    expect(new Set(seats.map((seat) => seat.userId))).toEqual(
      new Set(users.slice(1, 3).map((user) => user.id)),
    );
    expect(
      cancelled.packets.some((packet) => packet.event === 'MATCH_FOUND'),
    ).toBe(false);
    const status = await request(app.getHttpServer())
      .get('/v1/matchmaking/status')
      .auth(tokens[0], { type: 'bearer' })
      .expect(200);
    expect(status.body.status).toBe('CANCELLED');
  });

  it('recovers a committed game through status after a socket disconnect', async () => {
    const disconnected = await connect(0);
    await join(0).expect(201);
    const closed = once(disconnected.socket, 'close');
    disconnected.socket.terminate();
    await closed;
    const opponent = await connect(1);
    await join(1).expect(201);
    const found = await opponent.take('MATCH_FOUND');
    const recovered = await request(app.getHttpServer())
      .get('/v1/matchmaking/status')
      .auth(tokens[0], { type: 'bearer' })
      .expect(200);
    expect(recovered.body).toMatchObject({
      status: 'MATCHED',
      gameId: found.data.gameId,
    });
    await connect(0);
    const again = await request(app.getHttpServer())
      .get('/v1/matchmaking/status')
      .auth(tokens[0], { type: 'bearer' })
      .expect(200);
    expect(again.body.gameId).toBe(found.data.gameId);
    expect(await activeSeats()).toHaveLength(2);
  });

  it('withholds private match delivery from revoked sessions while preserving recovery', async () => {
    const expired = await connect(0);
    const opponent = await connect(1);
    await join(0).expect(201);
    const sessions = app.get(SessionService);
    const principal = await sessions.authenticate(tokens[0]);
    await sessions.revoke(principal.sessionId, users[0].id);
    await join(1).expect(201);
    const found = await opponent.take('MATCH_FOUND');
    expect(
      expired.packets.some((packet) => packet.event === 'MATCH_FOUND'),
    ).toBe(false);
    await request(app.getHttpServer())
      .get('/v1/matchmaking/status')
      .auth(tokens[0], { type: 'bearer' })
      .expect(401);
    const fresh = (await sessions.issue(users[0])).accessToken;
    const status = await request(app.getHttpServer())
      .get('/v1/matchmaking/status')
      .auth(fresh, { type: 'bearer' })
      .expect(200);
    expect(status.body).toMatchObject({
      status: 'MATCHED',
      gameId: found.data.gameId,
    });
  });

  it('rolls back failed game creation and retries the same queue entries safely', async () => {
    const first = await connect(0);
    const second = await connect(1);
    const failure = vi
      .spyOn(app.get(GamesService), 'createMatched')
      .mockRejectedValue(new Error('QA injected game creation failure'));
    try {
      await Promise.all([join(0).expect(201), join(1).expect(201)]);
      await app.get(MatchmakingWorker).tick();
      expect(failure).toHaveBeenCalled();
      expect(await activeSeats()).toHaveLength(0);
      const rows = await source.query(
        'SELECT status FROM matchmaking_queue WHERE "userId" = ANY($1::uuid[])',
        [users.slice(0, 2).map((user) => user.id)],
      );
      expect(rows).toHaveLength(2);
      expect(
        rows.every((row: { status: string }) => row.status === 'WAITING'),
      ).toBe(true);
      expect(
        first.packets.some((packet) => packet.event === 'MATCH_FOUND'),
      ).toBe(false);
      expect(
        second.packets.some((packet) => packet.event === 'MATCH_FOUND'),
      ).toBe(false);
    } finally {
      failure.mockRestore();
    }
    await app.get(MatchmakingWorker).tick();
    const [a, b] = await Promise.all([
      first.take('MATCH_FOUND'),
      second.take('MATCH_FOUND'),
    ]);
    expect(a.data.gameId).toBe(b.data.gameId);
    expect(await activeSeats()).toHaveLength(2);
  });
});
