import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { PresenceService } from '../dist/presence/presence.service.js';

describe('SCRUM-102 public user search endpoint', () => {
  let app: INestApplication<App>,
    source: DataSource,
    user: User,
    presence: PresenceService;
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    source = app.get(DataSource);
    presence = app.get(PresenceService);
    user = await source
      .getRepository(User)
      .save({
        username: `search_${randomUUID().slice(0, 8)}`,
        email: `private_${randomUUID()}@example.com`,
        emailVerifiedAt: new Date(),
        passwordHash: 'private-password',
        twoFactorSecret: 'private-totp',
        elo: 1452,
      });
  });
  afterAll(async () => {
    if (user) {
      presence.disconnect(user.id, 'test');
      await source.getRepository(User).delete(user.id);
    }
    await app?.close();
  });
  it('returns only the public search fields, including live presence', async () => {
    presence.connect(user.id, 'test');
    const response = await request(app.getHttpServer())
      .get('/v1/users/search')
      .query({ q: user.username })
      .expect(200);
    expect(response.body).toEqual({
      users: [
        { id: user.id, username: user.username, elo: 1452, online: true },
      ],
    });
  });
  it('trims queries and returns an empty named collection for no match', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .get('/v1/users/search')
          .query({ q: ` ${user.username} ` })
          .expect(200)
      ).body.users[0].id,
    ).toBe(user.id);
    expect(
      (
        await request(app.getHttpServer())
          .get('/v1/users/search')
          .query({ q: randomUUID().slice(0, 32) })
          .expect(200)
      ).body,
    ).toEqual({ users: [] });
  });
  it.each([
    {},
    { q: '' },
    { q: '   ' },
    { q: 'x'.repeat(33) },
    { q: ['alice', 'bob'] },
    { q: 'alice', elo: '9999' },
  ])('rejects malformed queries before data access: %j', async (query) => {
    const response = await request(app.getHttpServer())
      .get('/v1/users/search')
      .query(query)
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
  it('treats query SQL as literal input without modifying accounts', async () => {
    const before = await source
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    const response = await request(app.getHttpServer())
      .get('/v1/users/search')
      .query({ q: "' OR 1=1 --" })
      .expect(200);
    expect(response.body).toEqual({ users: [] });
    expect(
      await source.getRepository(User).findOneByOrFail({ id: user.id }),
    ).toEqual(before);
  });
});
