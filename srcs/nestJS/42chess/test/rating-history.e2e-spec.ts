import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ratingFixture } from './rating.fixture.js';
import { RatingModule } from '../dist/rating/rating.module.js';
import { RatingHistory } from '../dist/rating/rating-history.entity.js';
import { User } from '../dist/users/user.entity.js';
import { createValidationPipe } from '../dist/common/validation.js';
import { ApiExceptionFilter } from '../dist/common/api-exception.filter.js';

describe('Rating history HTTP contract (SCRUM-213)', () => {
  const f = ratingFixture();
  let app: INestApplication<App>;
  const path = (id: string) => `/v1/users/${id}/rating-history`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRootAsync({ useFactory: () => f.source.options }),
        RatingModule,
      ],
      providers: [
        { provide: APP_PIPE, useFactory: createValidationPipe },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('returns the exact specification projection with ISO dates and no account data', async () => {
    const [white, black] = await f.users();
    await f.source.manager.update(User, white.id, {
      email: 'private@example.test',
      passwordHash: 'private-hash',
      twoFactorSecret: 'private-secret',
    });
    const state = await f.finished(white, black);
    await f.apply(state);
    const row = await f.source.manager.findOneByOrFail(RatingHistory, {
      userId: white.id,
      gameId: state.game.id,
    });
    const response = await request(app.getHttpServer())
      .get(path(white.id))
      .expect(200);
    expect(response.body).toEqual({
      history: [
        {
          gameId: state.game.id,
          ratingBefore: 1200,
          ratingAfter: 1216,
          change: 16,
          createdAt: row.createdAt.toISOString(),
        },
      ],
    });
    const opponent = await request(app.getHttpServer())
      .get(path(black.id))
      .expect(200);
    expect(opponent.body.history[0]).toMatchObject({
      gameId: state.game.id,
      ratingBefore: 1200,
      ratingAfter: 1184,
      change: -16,
    });
  });

  it('returns an empty array for an existing user without history', async () => {
    const [user] = await f.users();
    const response = await request(app.getHttpServer())
      .get(path(user.id))
      .expect(200);
    expect(response.body).toEqual({ history: [] });
  });

  it('returns the existing USER_NOT_FOUND error convention for an unknown user', async () => {
    const response = await request(app.getHttpServer())
      .get(path(randomUUID()))
      .expect(404);
    expect(response.body).toEqual({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
      message: 'User does not exist.',
    });
  });

  it('orders multiple games newest-first and resolves timestamp ties by history UUID', async () => {
    const [white, black] = await f.users();
    const games: string[] = [];
    for (let i = 0; i < 3; i++) {
      const state = await f.finished(white, black);
      await f.apply(state);
      games.push(state.game.id);
    }
    const rows = await f.source.manager.findBy(RatingHistory, {
      userId: white.id,
    });
    for (const row of rows) {
      await f.source.manager.update(RatingHistory, row.id, {
        createdAt: new Date(
          row.gameId === games[0]
            ? '2026-01-01T00:00:00Z'
            : '2026-02-01T00:00:00Z',
        ),
      });
    }
    const newer = rows
      .filter((row) => row.gameId !== games[0])
      .sort((a, b) => b.id.localeCompare(a.id));
    const response = await request(app.getHttpServer())
      .get(path(white.id))
      .expect(200);
    expect(
      response.body.history.map((row: { gameId: string }) => row.gameId),
    ).toEqual([...newer.map((row) => row.gameId), games[0]]);
    const again = await request(app.getHttpServer())
      .get(path(white.id))
      .expect(200);
    expect(again.body).toEqual(response.body);
  });

  it('bounds queries by default and supports stable offset/limit pagination', async () => {
    const [white, black] = await f.users();
    for (let i = 0; i < 21; i++) await f.apply(await f.finished(white, black));
    const first = await request(app.getHttpServer())
      .get(path(white.id))
      .expect(200);
    const last = await request(app.getHttpServer())
      .get(path(white.id))
      .query({ limit: 20, offset: 20 })
      .expect(200);
    const all = await request(app.getHttpServer())
      .get(path(white.id))
      .query({ limit: 100 })
      .expect(200);
    expect(first.body.history).toHaveLength(20);
    expect(last.body.history).toHaveLength(1);
    expect([...first.body.history, ...last.body.history]).toEqual(
      all.body.history,
    );
    expect(
      new Set(all.body.history.map((row: { gameId: string }) => row.gameId))
        .size,
    ).toBe(21);
    const pastEnd = await request(app.getHttpServer())
      .get(path(white.id))
      .query({ offset: 21 })
      .expect(200);
    expect(pastEnd.body).toEqual({ history: [] });
  });

  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: 'bad' },
    { offset: -1 },
    { offset: 0.5 },
    { userId: randomUUID() },
  ])('rejects invalid or forged query filters %j', async (query) => {
    const [user] = await f.users();
    const response = await request(app.getHttpServer())
      .get(path(user.id))
      .query(query)
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed user identifiers', async () => {
    await request(app.getHttpServer()).get(path('invalid-id')).expect(400);
  });

  it('allows public reads without trusting bearer strings or actor headers', async () => {
    const [white, black] = await f.users();
    await f.apply(await f.finished(white, black));
    const anonymous = await request(app.getHttpServer())
      .get(path(white.id))
      .expect(200);
    const forged = await request(app.getHttpServer())
      .get(path(white.id))
      .set('Authorization', `Bearer ${black.id}`)
      .set('x-user-id', black.id)
      .expect(200);
    expect(forged.body).toEqual(anonymous.body);
    expect(forged.body.history[0].change).toBe(16);
  });

  it('does not include unrelated users or games in the requested history', async () => {
    const [white, black] = await f.users();
    const [other, opponent] = await f.users();
    const ownGame = await f.finished(white, black);
    const otherGame = await f.finished(other, opponent);
    await f.apply(ownGame);
    await f.apply(otherGame);
    const response = await request(app.getHttpServer())
      .get(path(white.id))
      .expect(200);
    expect(
      response.body.history.map((row: { gameId: string }) => row.gameId),
    ).toEqual([ownGame.game.id]);
  });

  it('exposes no client-controlled rating write operation', async () => {
    const [user] = await f.users();
    await request(app.getHttpServer())
      .patch(path(user.id))
      .send({ elo: 9999 })
      .expect(404);
    expect(
      (await f.source.manager.findOneByOrFail(User, { id: user.id })).elo,
    ).toBe(1200);
  });
});
