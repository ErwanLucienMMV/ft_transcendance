import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { PresenceService } from '../dist/presence/presence.service.js';

describe('SCRUM-100 public user profiles', () => {
  let app: INestApplication<App>,
    source: DataSource,
    presence: PresenceService,
    user: User;
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
        username: `public_${randomUUID().slice(0, 8)}`,
        email: `private_${randomUUID()}@example.com`,
        passwordHash: 'private-password',
        emailVerifiedAt: new Date(),
        twoFactorSecret: 'private-totp',
        emailVerificationTokenHash: 'private-token',
        gamesPlayed: 12,
        gamesWon: 5,
        gamesDraw: 3,
        gamesLost: 4,
        elo: 1300,
      });
  });
  afterAll(async () => {
    if (user) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  it('returns the exact public contract anonymously without internal account fields', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/users/${user.id}`)
      .expect(200);
    expect(response.body).toEqual({
      id: user.id,
      username: user.username,
      avatarUrl: null,
      elo: 1300,
      gamesPlayed: 12,
      online: false,
    });
  });
  it('uses the live registry and keeps a user online until their last tab leaves', async () => {
    presence.connect(user.id, 'one');
    presence.connect(user.id, 'two');
    expect(
      (
        await request(app.getHttpServer())
          .get(`/v1/users/${user.id}`)
          .expect(200)
      ).body.online,
    ).toBe(true);
    presence.disconnect(user.id, 'one');
    expect(
      (
        await request(app.getHttpServer())
          .get(`/v1/users/${user.id}`)
          .expect(200)
      ).body.online,
    ).toBe(true);
    presence.disconnect(user.id, 'two');
    expect(
      (
        await request(app.getHttpServer())
          .get(`/v1/users/${user.id}`)
          .expect(200)
      ).body.online,
    ).toBe(false);
  });
  it('distinguishes unknown UUIDs from malformed identifiers', async () => {
    const missing = await request(app.getHttpServer())
      .get(`/v1/users/${randomUUID()}`)
      .expect(404);
    expect(missing.body.code).toBe('USER_NOT_FOUND');
    await request(app.getHttpServer()).get('/v1/users/invalid-id').expect(400);
  });
  it('keeps the static current-user route authenticated', async () => {
    await request(app.getHttpServer()).get('/v1/users/me').expect(401);
  });
});
