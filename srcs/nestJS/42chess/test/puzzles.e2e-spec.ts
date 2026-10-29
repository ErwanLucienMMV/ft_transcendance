import { randomUUID } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SessionService } from '../dist/auth/session.service.js';
import { User } from '../dist/users/user.entity.js';
import { configurationOptions } from '../dist/config/environment.js';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PuzzlesModule } from '../dist/puzzles/puzzles.module.js';
import { createValidationPipe } from '../dist/common/validation.js';
import { ApiExceptionFilter } from '../dist/common/api-exception.filter.js';
import { HttpAdapterHost } from '@nestjs/core';
import { createPuzzleFixture } from './puzzle.fixture.js';

/** Only infrastructure is configured here; HTTP, JWT, PostgreSQL and chess rules are real. */
@Global()
@Module({})
class PuzzleDatabaseModule {}

describe('Daily puzzle HTTP flow (E2E-14)', () => {
  let f: Awaited<ReturnType<typeof createPuzzleFixture>>;
  let app: INestApplication<App>;
  let token: string;
  let otherToken: string;
  let puzzleId: string;
  let sessions: SessionService;
  beforeAll(async () => {
    f = await createPuzzleFixture();
    await f.load();
    puzzleId = (await f.reference()).id;
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ...configurationOptions, ignoreEnvFile: true }),
        {
          module: PuzzleDatabaseModule,
          providers: [{ provide: DataSource, useValue: f.source }],
          exports: [DataSource],
        },
        PuzzlesModule,
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new ApiExceptionFilter(app.get(HttpAdapterHost)));
    await app.init();
    sessions = app.get(SessionService);
    token = (
      await sessions.issue(
        await f.source.getRepository(User).findOneByOrFail({ id: f.alice }),
      )
    ).accessToken;
    otherToken = (
      await sessions.issue(
        await f.source.getRepository(User).findOneByOrFail({ id: f.bob }),
      )
    ).accessToken;
  });
  afterAll(async () => {
    await app?.close();
    await f?.close();
  });
  function http() {
    return request(app.getHttpServer());
  }
  async function start(id = puzzleId) {
    const response = await http()
      .post(`/v1/puzzles/${id}/attempts`)
      .auth(token, { type: 'bearer' })
      .expect(201);
    return response.body as { attemptId: string; version: number; fen: string };
  }

  it('returns the same solution-free daily puzzle to concurrent anonymous readers', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        http().get('/v1/puzzles/daily').expect(200),
      ),
    );
    for (const response of results) {
      expect(response.body).toEqual(results[0].body);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(Object.keys(results[0].body).sort()).toEqual([
      'date',
      'fen',
      'id',
      'rating',
      'themes',
    ]);
    expect(JSON.stringify(results[0].body)).not.toMatch(
      /solution|sourceId|moves|playerId/,
    );
  });

  it('plays the actual daily puzzle through to completion without exposing future moves', async () => {
    const daily = (await http().get('/v1/puzzles/daily').expect(200)).body;
    const [stored] = await f.source.query(
      'SELECT solution FROM puzzles WHERE id=$1',
      [daily.id],
    );
    const attempt = await start(daily.id);
    let version = 0;
    for (let ply = 0; ply < stored.solution.length; ply += 2) {
      const response = await http()
        .post(`/v1/puzzles/attempts/${attempt.attemptId}/moves`)
        .auth(token, { type: 'bearer' })
        .send({ move: stored.solution[ply], version })
        .expect(200);
      version++;
      expect(response.body).toMatchObject({
        correct: true,
        version,
        completed: ply + 1 === stored.solution.length,
      });
      expect(response.body).not.toHaveProperty('solution');
      expect(response.body).not.toHaveProperty('moves');
      expect(response.body.fen).toBe(response.body.nextPosition);
    }
    const state = await http()
      .get(`/v1/puzzles/attempts/${attempt.attemptId}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(state.body.completed).toBe(true);
  });

  it('retries an incorrect move and resumes the persisted position', async () => {
    const attempt = await start();
    const wrong = await http()
      .post(`/v1/puzzles/attempts/${attempt.attemptId}/moves`)
      .auth(token, { type: 'bearer' })
      .send({ move: 'a1a8', version: 0 })
      .expect(200);
    expect(wrong.body).toMatchObject({
      correct: false,
      completed: false,
      version: 1,
      fen: attempt.fen,
      attempts: 1,
    });
    const accepted = await http()
      .post(`/v1/puzzles/attempts/${attempt.attemptId}/moves`)
      .auth(token, { type: 'bearer' })
      .send({ move: 'a2e6', version: 1 })
      .expect(200);
    expect(accepted.body).toMatchObject({
      correct: true,
      opponentMove: 'd7d8',
      ply: 2,
    });
    const state = await http()
      .get(`/v1/puzzles/attempts/${attempt.attemptId}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(state.body).toMatchObject({
      fen: accepted.body.fen,
      version: 2,
      ply: 2,
    });
  });

  it('uses actual bearer verification and rejects forged identity claims', async () => {
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    for (const bearer of [
      undefined,
      f.alice,
      'invalid.jwt.token',
      await jwt.signAsync(
        { sub: f.alice, username: 'puzzle_alice' },
        { expiresIn: 300 },
      ),
      await jwt.signAsync(
        { sub: f.alice, jti: randomUUID(), typ: '2fa-challenge' },
        { expiresIn: 300 },
      ),
      await jwt.signAsync(
        { sub: f.alice, jti: randomUUID(), typ: 'access' },
        { expiresIn: -1 },
      ),
    ]) {
      const call = http()
        .post(`/v1/puzzles/${puzzleId}/attempts`)
        .send({ userId: f.alice });
      if (bearer) call.auth(bearer, { type: 'bearer' });
      expect((await call.expect(401)).body.code).toBe('AUTH_REQUIRED');
    }
  });

  it('revokes puzzle access after logout without changing progress or another session', async () => {
    const user = await f.source
      .getRepository(User)
      .findOneByOrFail({ id: f.alice });
    const revoked = (await sessions.issue(user)).accessToken;
    const attempt = (
      await http()
        .post(`/v1/puzzles/${puzzleId}/attempts`)
        .auth(revoked, { type: 'bearer' })
        .expect(201)
    ).body;
    await http()
      .post('/v1/auth/logout')
      .auth(revoked, { type: 'bearer' })
      .expect(204);
    for (const call of [
      () => http().post(`/v1/puzzles/${puzzleId}/attempts`),
      () => http().get(`/v1/puzzles/attempts/${attempt.attemptId}`),
      () =>
        http()
          .post(`/v1/puzzles/attempts/${attempt.attemptId}/moves`)
          .send({ move: 'a2e6', version: 0 }),
    ]) {
      expect(
        (await call().auth(revoked, { type: 'bearer' }).expect(401)).body.code,
      ).toBe('AUTH_REQUIRED');
    }
    const state = await http()
      .get(`/v1/puzzles/attempts/${attempt.attemptId}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(state.body).toEqual(attempt);
  });

  it('does not reveal or mutate another user attempt', async () => {
    const attempt = await start();
    await http()
      .get(`/v1/puzzles/attempts/${attempt.attemptId}`)
      .auth(otherToken, { type: 'bearer' })
      .expect(404);
    await http()
      .post(`/v1/puzzles/attempts/${attempt.attemptId}/moves`)
      .auth(otherToken, { type: 'bearer' })
      .send({ move: 'a2e6', version: 0 })
      .expect(404);
  });

  it.each([
    {},
    { move: 'a2e6' },
    { move: 'a9e6', version: 0 },
    { move: 'a2e6', version: -1 },
    { move: 'a2e6', version: '0' },
    { move: 'a2e6', version: 0, solved: true },
    { move: 'a2e6', version: 0, fen: 'forged' },
  ])('rejects malformed or client-controlled state: %j', async (body) => {
    const attempt = await start();
    expect(
      (
        await http()
          .post(`/v1/puzzles/attempts/${attempt.attemptId}/moves`)
          .auth(token, { type: 'bearer' })
          .send(body)
          .expect(400)
      ).body.code,
    ).toBe('VALIDATION_ERROR');
  });

  it('rejects replaying a stale version', async () => {
    const attempt = await start();
    const path = `/v1/puzzles/attempts/${attempt.attemptId}/moves`;
    await http()
      .post(path)
      .auth(token, { type: 'bearer' })
      .send({ move: 'a2e6', version: 0 })
      .expect(200);
    expect(
      (
        await http()
          .post(path)
          .auth(token, { type: 'bearer' })
          .send({ move: 'a2e6', version: 0 })
          .expect(409)
      ).body.code,
    ).toBe('PUZZLE_STALE_VERSION');
  });

  it('distinguishes invalid UUIDs and missing resources', async () => {
    await http()
      .post('/v1/puzzles/not-an-id/attempts')
      .auth(token, { type: 'bearer' })
      .expect(400);
    await http()
      .post(`/v1/puzzles/${randomUUID()}/attempts`)
      .auth(token, { type: 'bearer' })
      .expect(404);
    await http()
      .get(`/v1/puzzles/attempts/${randomUUID()}`)
      .auth(token, { type: 'bearer' })
      .expect(404);
  });

  it('returns an uncached public 503 for an empty catalogue and recovers after import', async () => {
    await f.clear();
    try {
      const unavailable = await http().get('/v1/puzzles/daily').expect(503);
      expect(unavailable.headers['cache-control']).toBe('no-store');
      expect(unavailable.body).toMatchObject({
        statusCode: 503,
        code: 'PUZZLE_CATALOG_EMPTY',
      });
      expect(await f.source.query('SELECT id FROM daily_puzzles')).toEqual([]);
    } finally {
      await f.load();
    }
    const recovered = await http().get('/v1/puzzles/daily').expect(200);
    expect(recovered.headers['cache-control']).toBe('no-store');
    expect(Object.keys(recovered.body).sort()).toEqual([
      'date',
      'fen',
      'id',
      'rating',
      'themes',
    ]);
  });
});
