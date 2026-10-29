import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { GamesService } from '../dist/games/games.service.js';
import { User } from '../dist/users/user.entity.js';

describe('Player game history (HISTORY-03/04/05/06/07/08)', () => {
  let app: INestApplication<App>;
  let source: DataSource;
  let games: GamesService;
  let white: User, black: User, idle: User;
  const control = { initialTime: 300000, increment: 0 };
  const path = (id: string) => `/v1/users/${id}/games`;

  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    process.env.BOT_ENGINE_URL =
      process.env.TEST_BOT_ENGINE_URL ?? 'ws://127.0.0.1:55434';
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    source = app.get(DataSource);
    games = app.get(GamesService);
    const users = source.getRepository(User);
    const suffix = randomUUID().slice(0, 8);
    [white, black, idle] = await users.save(
      ['white', 'black', 'idle'].map((name) =>
        users.create({
          username: `hist_${name}_${suffix}`,
          email: `hist_${name}_${suffix}@example.test`,
          passwordHash: 'private-hash',
          emailVerifiedAt: new Date(),
        }),
      ),
    );
  });
  afterAll(async () => {
    if (source?.isInitialized) {
      const ids = [white, black, idle].filter(Boolean).map((user) => user.id);
      // Rated games keep rating rows that reference both the game and the users.
      await source.query(
        'DELETE FROM rating_history WHERE "userId" = ANY($1)',
        [ids],
      );
      await source.query(
        'DELETE FROM games WHERE id IN (SELECT "gameId" FROM game_players WHERE "userId" = ANY($1))',
        [ids],
      );
      await source.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    }
    await app?.close();
  });

  async function started() {
    const { game } = await games.create(white.id, {
      ...control,
      opponentId: null,
    });
    await games.join(black.id, game.id);
    return game.id as string;
  }

  it('lists only finished games, newest first, from the requested seat', async () => {
    const won = await started();
    await games.play(white.id, won, 'e2e4');
    await games.resign(black.id, won);
    const drawn = await started();
    await games.offerDraw(white.id, drawn);
    await games.acceptDraw(black.id, drawn);
    await started(); // still active
    await games.create(white.id, { ...control, opponentId: null }); // waiting

    const mine = await request(app.getHttpServer())
      .get(path(white.id))
      .expect(200);
    expect(mine.body).toMatchObject({ total: 2, limit: 20, offset: 0 });
    expect(mine.body.items.map((item: { id: string }) => item.id)).toEqual([
      drawn,
      won,
    ]);
    const [draw, win] = mine.body.items;
    expect(draw).toMatchObject({
      color: 'WHITE',
      outcome: 'DRAW',
      reason: 'DRAW_AGREEMENT',
      moveCount: 0,
    });
    expect(win).toEqual({
      id: won,
      color: 'WHITE',
      opponent: {
        id: black.id,
        username: black.username,
        avatarUrl: null,
        elo: expect.any(Number),
        color: 'BLACK',
      },
      outcome: 'WIN',
      reason: 'RESIGNATION',
      timeControl: control,
      moveCount: 1,
      startedAt: expect.any(String),
      endedAt: expect.any(String),
    });
    expect(Date.parse(win.endedAt)).toBeLessThanOrEqual(
      Date.parse(draw.endedAt),
    );
    // No account data of the opponent leaks into a public list.
    expect(JSON.stringify(mine.body)).not.toMatch(
      /private-hash|@example\.test/,
    );

    const theirs = await request(app.getHttpServer())
      .get(path(black.id))
      .expect(200);
    expect(theirs.body.items[1]).toMatchObject({
      id: won,
      color: 'BLACK',
      outcome: 'LOSS',
      opponent: { id: white.id, color: 'WHITE' },
    });
  });

  it('pages with limit and offset and keeps the total', async () => {
    const page = await request(app.getHttpServer())
      .get(path(white.id))
      .query({ limit: 1, offset: 1 })
      .expect(200);
    expect(page.body).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(page.body.items).toHaveLength(1);
    const past = await request(app.getHttpServer())
      .get(path(white.id))
      .query({ offset: 5 })
      .expect(200);
    expect(past.body).toEqual({ items: [], total: 2, limit: 20, offset: 5 });
  });

  it('names the bot opponent of a finished bot game', async () => {
    const { game } = await games.createBot(
      idle.id,
      { ...control, color: 'WHITE', opponentId: null },
      'EASY',
    );
    await games.resign(idle.id, game.id);
    const response = await request(app.getHttpServer())
      .get(path(idle.id))
      .expect(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({
        id: game.id,
        outcome: 'LOSS',
        opponent: expect.objectContaining({
          username: 'Bot EASY',
          elo: null,
          botDifficulty: 'EASY',
        }),
      }),
    ]);
  });

  it('answers an empty page, a missing user and invalid queries with the API contract', async () => {
    const [user] = await source
      .getRepository(User)
      .save([
        source
          .getRepository(User)
          .create({ username: `hist_new_${randomUUID().slice(0, 8)}` }),
      ]);
    try {
      await request(app.getHttpServer())
        .get(path(user.id))
        .expect(200, { items: [], total: 0, limit: 20, offset: 0 });
    } finally {
      await source.getRepository(User).delete(user.id);
    }
    const missing = await request(app.getHttpServer())
      .get(path(randomUUID()))
      .expect(404);
    expect(missing.body).toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
    });
    await request(app.getHttpServer()).get(path('not-a-uuid')).expect(400);
    for (const query of [
      { limit: 0 },
      { limit: 101 },
      { offset: -1 },
      { limit: 'x' },
    ])
      await request(app.getHttpServer())
        .get(path(white.id))
        .query(query)
        .expect(400);
  });
});
