import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
// Exercise the compiled application, including TypeScript decorator metadata.
import { AppModule } from './../dist/app.module.js';

describe('POST /v1/auth/register (e2e)', () => {
  let app: INestApplication<App>;
  let database: DataSource;
  let appliedMigrations = 0;
  const suffix = randomUUID().slice(0, 8);

  function body(overrides: Record<string, unknown> = {}) {
    return {
      username: `alice_${suffix}`,
      email: `alice_${suffix}@example.com`,
      password: 'correct-horse',
      ...overrides,
    };
  }

  function register(payload: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/v1/auth/register').send(payload);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = app.get(DataSource);
    appliedMigrations = (await database.runMigrations()).length;
  });

  afterAll(async () => {
    for (let i = 0; i < appliedMigrations; i++) {
      await database.undoLastMigration();
    }
    await app.close();
  });

  it('creates the account and returns only public fields', async () => {
    const response = await register(body()).expect(201);

    expect(response.body).toEqual({
      user: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        username: `alice_${suffix}`,
        elo: 1200,
      },
    });
  });

  it('stores an Argon2id hash and a lowercase email', async () => {
    const [row] = await database.query(
      'SELECT email, "passwordHash" FROM users WHERE username = $1',
      [`alice_${suffix}`],
    );

    expect(row.email).toBe(`alice_${suffix}@example.com`);
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects a taken username with 409', async () => {
    const response = await register(
      body({ email: `other_${suffix}@example.com` }),
    ).expect(409);

    expect(response.body.code).toBe('USERNAME_ALREADY_EXISTS');
  });

  it('rejects a taken email, whatever its case, with 409', async () => {
    const response = await register(
      body({
        username: `bob_${suffix}`,
        email: `ALICE_${suffix}@Example.com`,
      }),
    ).expect(409);

    expect(response.body.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('rejects an invalid body with 400', async () => {
    const response = await register(body({ password: 'short' })).expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('refuses fields the client must not set, such as elo', async () => {
    await register(body({ username: `eve_${suffix}`, elo: 3000 })).expect(400);
  });
});
