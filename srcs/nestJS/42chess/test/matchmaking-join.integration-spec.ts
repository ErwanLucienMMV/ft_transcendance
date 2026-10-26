import { randomUUID, createHmac } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import cliDataSource from '../dist/database/data-source.js';
import { MatchmakingService } from '../dist/matchmaking/matchmaking.service.js';
import { MatchmakingController } from '../dist/matchmaking/matchmaking.controller.js';
import { HttpAuthGuard } from '../dist/common/http-auth.guard.js';
import { createValidationPipe } from '../dist/common/validation.js';
import { User } from '../dist/users/user.entity.js';
import { MatchmakingEntry } from '../dist/matchmaking/matchmaking-queue.entity.js';

describe('MATCH-01 queue join on PostgreSQL and Nest HTTP', () => {
  const schema = `match_join_${randomUUID().replaceAll('-', '')}`;
  const secret = 'test-matchmaking-secret-of-32-characters!';
  const jwt = new JwtService({
    secret,
    signOptions: { algorithm: 'HS256', expiresIn: 300 },
  });
  const control = { initialTime: 300000, increment: 2000 };
  let source: DataSource;
  let service: MatchmakingService;
  let app: INestApplication<App>;
  let actor: string;

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
      entities: [User, MatchmakingEntry],
      extra: { ...options.extra, options: `-c search_path=${schema},public` },
    });
    await source.initialize();
    await source.runMigrations();
    service = new MatchmakingService(source);
    const module = await Test.createTestingModule({
      controllers: [MatchmakingController],
      providers: [
        HttpAuthGuard,
        { provide: DataSource, useValue: source },
        { provide: MatchmakingService, useValue: service },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_SECRET: secret }),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (source?.isInitialized) {
      try {
        await source.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await source.destroy();
      }
    }
  });

  beforeEach(async () => {
    await source.query('TRUNCATE users, games CASCADE');
    const [user]: { id: string }[] = await source.query(
      `INSERT INTO users (username, elo, "emailVerifiedAt") VALUES ('queue_actor', 1575, now()) RETURNING id`,
    );
    actor = user.id;
  });

  const queue = async () =>
    (
      await source.query(
        'SELECT * FROM matchmaking_queue WHERE "userId" = $1',
        [actor],
      )
    )[0];
  const post = (body: unknown, token?: string) => {
    const call = request(app.getHttpServer()).post('/v1/matchmaking/join');
    if (token) call.set('Authorization', `Bearer ${token}`);
    return call.send(body);
  };
  const token = () => jwt.signAsync({ sub: actor, username: 'queue_actor' });

  it('accepts a real access token and persists server Elo with millisecond controls', async () => {
    const response = await post({ timeControl: control }, await token()).expect(
      201,
    );
    expect(response.body).toEqual({
      status: 'WAITING',
      joinedAt: expect.any(String),
    });
    const row = await queue();
    expect(row).toMatchObject({
      userId: actor,
      rating: 1575,
      status: 'WAITING',
      ...control,
    });
    expect(response.body.joinedAt).toBe(row.createdAt.toISOString());
  });

  it('rejects duplicate WAITING joins without changing the original queue age or controls', async () => {
    await service.join(actor, control);
    const original = await queue();
    await post(
      { timeControl: { initialTime: 60000, increment: 0 } },
      await token(),
    )
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('ALREADY_IN_QUEUE'));
    expect(await queue()).toEqual(original);
  });

  it.each(['MATCHED', 'CANCELLED'])(
    'atomically reuses a %s entry with fresh rating and FIFO age',
    async (status) => {
      await service.join(actor, control);
      const original = await queue();
      await source.query(
        `UPDATE matchmaking_queue SET status = $2, "createdAt" = now() - interval '1 hour' WHERE "userId" = $1`,
        [actor, status],
      );
      await source.query('UPDATE users SET elo = 1630 WHERE id = $1', [actor]);
      const result = await service.join(actor, {
        initialTime: 60000,
        increment: 0,
      });
      const row = await queue();
      expect(row).toMatchObject({
        id: original.id,
        userId: actor,
        status: 'WAITING',
        rating: 1630,
        initialTime: 60000,
        increment: 0,
      });
      expect(row.createdAt.getTime()).toBeGreaterThan(
        original.createdAt.getTime(),
      );
      expect(result.joinedAt).toEqual(row.createdAt);
    },
  );

  it('serializes concurrent first joins across database connections', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => service.join(actor, control)),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason.getResponse().code).toBe('ALREADY_IN_QUEUE');
    const [count] = await source.query(
      'SELECT count(*)::int AS value FROM matchmaking_queue WHERE "userId" = $1',
      [actor],
    );
    expect(count.value).toBe(1);
  });

  it('rejects active game participants without changing a matched row', async () => {
    await service.join(actor, control);
    await source.query(
      `UPDATE matchmaking_queue SET status='MATCHED' WHERE "userId"=$1`,
      [actor],
    );
    const original = await queue();
    const [game] = await source.query(
      `INSERT INTO games (status, "initialTime", "startedAt") VALUES ('ACTIVE', 300000, now()) RETURNING id`,
    );
    await source.query(
      `INSERT INTO game_players ("gameId", "userId", color) VALUES ($1, $2, 'WHITE')`,
      [game.id, actor],
    );
    await post({ timeControl: control }, await token())
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('ACTIVE_GAME_EXISTS'));
    expect(await queue()).toEqual(original);
  });

  it.each([
    {},
    { timeControl: null },
    { timeControl: [] },
    { timeControl: { initialTime: 0, increment: 0 } },
    { timeControl: { initialTime: 300000, increment: -1 } },
    { timeControl: { initialTime: '300000', increment: 0 } },
    { timeControl: { initialTime: 300000.5, increment: 0 } },
    { timeControl: { initialTime: 2147483648, increment: 0 } },
    { timeControl: { initialTime: 300000, increment: 2147483648 } },
    { timeControl: { initialTime: 300000 } },
    { timeControl: { ...control, rating: 9999 } },
    { timeControl: control, elo: 9999 },
    { timeControl: control, userId: randomUUID() },
  ])('rejects invalid or forged input %j before persistence', async (input) => {
    await post(input, await token()).expect(400);
    expect(await queue()).toBeUndefined();
  });

  it('rejects missing, forged, expired, foreign-purpose and non-expiring tokens', async () => {
    const challengeSecret = createHmac('sha256', secret)
      .update('2fa-challenge')
      .digest('base64url');
    const tokens = [
      undefined,
      actor,
      await jwt.signAsync({ sub: actor }, { secret: 'another-secret' }),
      await jwt.signAsync({ sub: actor }, { expiresIn: -1 }),
      await jwt.signAsync({ sub: actor }, { algorithm: 'HS384' }),
      await jwt.signAsync(
        { sub: actor, typ: '2fa-challenge' },
        { secret: challengeSecret },
      ),
      await jwt.signAsync({ sub: actor, typ: '2fa-challenge' }),
      await new JwtService({ secret }).signAsync({ sub: actor }),
      await jwt.signAsync({ sub: randomUUID() }),
    ];
    for (const access of tokens)
      await post({ timeControl: control }, access).expect(401);
    expect(await queue()).toBeUndefined();
  });

  it('rejects an account that became unverified after its token was issued', async () => {
    const access = await token();
    await source.query('UPDATE users SET "emailVerifiedAt"=NULL WHERE id=$1', [
      actor,
    ]);
    await post({ timeControl: control }, access).expect(403);
    expect(await queue()).toBeUndefined();
  });
});
