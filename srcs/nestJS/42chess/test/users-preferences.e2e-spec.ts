import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sessionToken } from './session.fixture.js';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';

describe('SCRUM-99 persisted preferences', () => {
  let app: INestApplication<App>, source: DataSource, user: User, token: string;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    source = app.get(DataSource);
    user = await source
      .getRepository(User)
      .save({
        username: `prefs_${randomUUID().slice(0, 8)}`,
        emailVerifiedAt: new Date(),
      });
    token = await sessionToken(app, user.id);
  });
  afterAll(async () => {
    if (user) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  const patch = (preferences: unknown) =>
    request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferences });
  it('migrates accounts with complete defaults', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.preferences).toEqual({
      language: 'en',
      theme: 'system',
      soundEnabled: true,
    });
  });
  it('preserves unspecified preferences across sequential and concurrent patches', async () => {
    await patch({ language: 'fr' }).expect(200);
    const responses = await Promise.all([
      patch({ theme: 'dark' }),
      patch({ soundEnabled: false }),
    ]);
    expect(responses.map((result) => result.status)).toEqual([200, 200]);
    expect(
      (await source.getRepository(User).findOneByOrFail({ id: user.id }))
        .preferences,
    ).toEqual({ language: 'fr', theme: 'dark', soundEnabled: false });
    expect((await patch({}).expect(200)).body.preferences).toEqual({
      language: 'fr',
      theme: 'dark',
      soundEnabled: false,
    });
  });
  it.each([
    null,
    [],
    'dark',
    { theme: null },
    { theme: 'invalid' },
    { language: 'xx' },
    { soundEnabled: 'false' },
    { soundEnabled: null },
    { elo: 9999 },
    { theme: 'light', extra: true },
  ])('rejects malformed preferences atomically: %j', async (preferences) => {
    const before = await source
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    await patch(preferences).expect(400);
    expect(
      await source.getRepository(User).findOneByOrFail({ id: user.id }),
    ).toEqual(before);
  });
});
