import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { GamesService } from '../dist/games/games.service.js';
import { User } from '../dist/users/user.entity.js';

describe('Game REST contract (real PostgreSQL and C++ engine)', () => {
  let app: INestApplication<App>;
  let source: DataSource;
  let games: GamesService;
  let white: User, black: User, outsider: User;
  const owned: string[] = [];
  const tokens = new Map<string, string>();
  const control = { initialTime: 300000, increment: 2000 };

  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    // Only the external authentication boundary is simulated. Production never
    // reads actor IDs from headers or body; the actual game guard runs in tests.
    app.use(
      (
        req: Request & { user?: { id: string } },
        _res: Response,
        next: NextFunction,
      ) => {
        const id = tokens.get(req.headers.authorization ?? '');
        if (id) req.user = { id };
        next();
      },
    );
    await app.init();
    source = app.get(DataSource);
    games = app.get(GamesService);
    const users = source.getRepository(User);
    const suffix = randomUUID().slice(0, 8);
    [white, black, outsider] = await users.save(
      ['white', 'black', 'outside'].map((name) =>
        users.create({
          username: `api_${name}_${suffix}`,
          emailVerifiedAt: new Date(),
        }),
      ),
    );
    tokens.set('Bearer fixture-white', white.id);
    tokens.set('Bearer fixture-black', black.id);
  });
  afterAll(async () => {
    if (source?.isInitialized) {
      for (const id of owned) {
        await source.query('DELETE FROM rating_history WHERE "gameId"=$1', [
          id,
        ]);
        await source.query('DELETE FROM games WHERE id=$1', [id]);
      }
      for (const user of [white, black, outsider])
        if (user)
          await source.query('DELETE FROM users WHERE id=$1', [user.id]);
    }
    await app?.close();
  });
  async function create(opponentId: string | null = null) {
    const response = await request(app.getHttpServer())
      .post('/v1/games')
      .set('Authorization', 'Bearer fixture-white')
      .send({ opponentId, timeControl: control })
      .expect(201);
    owned.push(response.body.gameId);
    return response.body.gameId as string;
  }

  it('creates WAITING from the nested spec DTO and binds the actor from trusted context', async () => {
    const id = await create();
    const state = await games.get(id);
    expect(state.game).toMatchObject({
      status: 'WAITING',
      initialTime: 300000,
      increment: 2000,
    });
    expect(state.players).toMatchObject([{ userId: white.id, color: 'WHITE' }]);
  });

  it('refuses anonymous, forged and unverified-bearer identities without inserting games', async () => {
    for (const header of [undefined, `Bearer ${white.id}`]) {
      const before = await source.query('SELECT id FROM games');
      const call = request(app.getHttpServer())
        .post('/v1/games')
        .send({ opponentId: null, timeControl: control, userId: white.id });
      if (header) call.set('Authorization', header);
      const response = await call.expect(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
      expect(await source.query('SELECT id FROM games')).toEqual(before);
    }
  });

  it.each([
    { timeControl: { initialTime: 0, increment: 0 }, opponentId: null },
    { timeControl: { initialTime: 60000, increment: -1 }, opponentId: null },
    { timeControl: { initialTime: '60000', increment: 0 }, opponentId: null },
    {
      timeControl: { initialTime: 60000, increment: 0, white: 999 },
      opponentId: null,
    },
    { timeControl: null, opponentId: null },
    { opponentId: null },
    { timeControl: control, opponentId: 'bad-id' },
    { timeControl: control, opponentId: null, userId: 'forged' },
  ])(
    'rejects malformed/extra input before persistence: %j',
    async (payload) => {
      const response = await request(app.getHttpServer())
        .post('/v1/games')
        .set('Authorization', 'Bearer fixture-white')
        .send(payload)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    },
  );

  it('reserves a requested opponent until that user accepts the seat', async () => {
    const id = await create(black.id);
    const before = await games.get(id);
    await expect(games.join(outsider.id, id)).rejects.toMatchObject({
      code: 'NOT_INVITED',
    });
    expect(await games.get(id)).toEqual(before);
    await games.join(black.id, id);
    expect((await games.get(id)).game.status).toBe('ACTIVE');
  });

  it('rejects self invitations and missing opponents atomically', async () => {
    for (const [opponentId, status, code] of [
      [white.id, 400, 'INVALID_GAME_INPUT'],
      [randomUUID(), 404, 'USER_NOT_FOUND'],
    ] as const) {
      const before = await source.query('SELECT id FROM games');
      const response = await request(app.getHttpServer())
        .post('/v1/games')
        .set('Authorization', 'Bearer fixture-white')
        .send({ opponentId, timeControl: control })
        .expect(status);
      expect(response.body.code).toBe(code);
      expect(await source.query('SELECT id FROM games')).toEqual(before);
    }
  });

  it('returns public player refs, board, clocks and dates without internal state or secrets', async () => {
    const id = await create(black.id);
    const waiting = await request(app.getHttpServer())
      .get(`/v1/games/${id}`)
      .expect(200);
    expect(waiting.body.blackPlayer).toBeNull();
    await games.join(black.id, id);
    const response = await request(app.getHttpServer())
      .get(`/v1/games/${id}`)
      .expect(200);
    expect(response.body).toMatchObject({
      id,
      status: 'ACTIVE',
      whitePlayer: {
        id: white.id,
        username: white.username,
        color: 'WHITE',
        avatarUrl: null,
        elo: 1200,
      },
      blackPlayer: { id: black.id, username: black.username, color: 'BLACK' },
      board: { turn: 'WHITE', halfmoveClock: 0, fullmoveNumber: 1 },
      clocks: { black: 300000 },
      result: null,
      timeControl: control,
    });
    expect(response.body.clocks.white).toBeGreaterThan(0);
    expect(response.body.clocks.white).toBeLessThanOrEqual(300000);
    expect(response.body.startedAt).toMatch(/Z$/);
    expect(response.body.createdAt).toMatch(/Z$/);
    expect(response.body.endedAt).toBeNull();
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|email|joinedAt|updatedAt|initialFen|invitedOpponent|clockDeadline|"moves"/,
    );
  });

  it('returns complete, ordered move history with SAN, actor IDs and UTC timestamps', async () => {
    const id = await create();
    await games.join(black.id, id);
    await games.play(white.id, id, 'e2e4');
    await games.play(black.id, id, 'e7e5');
    const response = await request(app.getHttpServer())
      .get(`/v1/games/${id}/moves`)
      .expect(200);
    expect(response.body.moves).toHaveLength(2);
    expect(response.body.moves).toMatchObject([
      { number: 1, playerId: white.id, from: 'e2', to: 'e4', notation: 'e4' },
      { number: 2, playerId: black.id, from: 'e7', to: 'e5', notation: 'e5' },
    ]);
    expect(response.body.moves[0].fen).toContain(' b ');
    expect(response.body.moves[0].timestamp).toMatch(/Z$/);
    expect(Object.keys(response.body.moves[0]).sort()).toEqual([
      'fen',
      'from',
      'notation',
      'number',
      'playerId',
      'timestamp',
      'to',
    ]);
  });

  it('returns a structured terminal result and freezes the clocks', async () => {
    const id = await create();
    await games.join(black.id, id);
    await games.resign(black.id, id);
    const response = await request(app.getHttpServer())
      .get(`/v1/games/${id}`)
      .expect(200);
    expect(response.body).toMatchObject({
      status: 'FINISHED',
      result: { winner: 'WHITE', reason: 'RESIGNATION' },
    });
    const second = await request(app.getHttpServer())
      .get(`/v1/games/${id}`)
      .expect(200);
    expect(second.body).toEqual(response.body);
  });

  it.each(['', '/moves'])(
    'distinguishes malformed and absent game IDs for %s',
    async (suffix) => {
      await request(app.getHttpServer())
        .get(`/v1/games/bad-id${suffix}`)
        .expect(400);
      const response = await request(app.getHttpServer())
        .get(`/v1/games/${randomUUID()}${suffix}`)
        .expect(404);
      expect(response.body.code).toBe('GAME_NOT_FOUND');
    },
  );
});
