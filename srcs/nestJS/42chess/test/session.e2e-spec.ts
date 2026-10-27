import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { SessionService } from '../dist/auth/session.service.js';
import { TwoFactorChallengeService } from '../dist/auth/two-factor-challenge.service.js';

describe('Session HTTP contract (SCRUM-77/78/79/80/91/92)', () => {
  let app: INestApplication,
    source: DataSource,
    sessions: SessionService,
    user: User;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    source = app.get(DataSource);
    sessions = app.get(SessionService);
    user = await source
      .getRepository(User)
      .save(
        source
          .getRepository(User)
          .create({
            username: `session_${randomUUID().slice(0, 8)}`,
            emailVerifiedAt: new Date(),
          }),
      );
  });
  afterAll(async () => {
    if (user) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  it('protects current user and logout against missing or malformed credentials', async () => {
    for (const header of ['', 'Bearer invalid', 'Basic abc']) {
      await request(app.getHttpServer())
        .get('/v1/users/me')
        .set('Authorization', header)
        .expect(401);
      await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', header)
        .expect(401);
    }
  });
  it('returns a whitelist of current-user fields and revokes only the logged-out session', async () => {
    const a = await sessions.issue(user),
      b = await sessions.issue(user);
    const response = await request(app.getHttpServer())
      .get('/v1/users/me')
      .auth(a.accessToken, { type: 'bearer' })
      .expect(200);
    expect(response.body).toMatchObject({
      id: user.id,
      username: user.username,
      elo: 1200,
    });
    for (const key of [
      'passwordHash',
      'twoFactorSecret',
      'emailVerificationTokenHash',
      'sessionId',
    ])
      expect(response.body).not.toHaveProperty(key);
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .auth(a.accessToken, { type: 'bearer' })
      .expect(204);
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .auth(a.accessToken, { type: 'bearer' })
      .expect(401);
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .auth(b.accessToken, { type: 'bearer' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .auth(a.accessToken, { type: 'bearer' })
      .expect(401);
  });
  it('refuses 2FA challenge tokens and deleted/unverified accounts', async () => {
    const challenge = await app.get(TwoFactorChallengeService).issue(user.id);
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .auth(challenge, { type: 'bearer' })
      .expect(401);
    const { accessToken } = await sessions.issue(user);
    await source.getRepository(User).update(user.id, { emailVerifiedAt: null });
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .auth(accessToken, { type: 'bearer' })
      .expect(401);
    await source
      .getRepository(User)
      .update(user.id, { emailVerifiedAt: new Date() });
  });
});
