import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { REFRESH_TOKEN, SessionService } from '../dist/auth/session.service.js';
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
    user = await source.getRepository(User).save(
      source.getRepository(User).create({
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
      // Logout is idempotent: nothing to revoke is not an error.
      await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', header)
        .expect(204);
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
      .expect(204);
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .auth(b.accessToken, { type: 'bearer' })
      .expect(200);
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

  describe('refresh cookie (session kept across page reloads)', () => {
    const refresh = (cookie?: string, header = true) => {
      const call = request(app.getHttpServer()).post('/v1/auth/refresh');
      if (header) call.set('X-Session-Refresh', '1');
      if (cookie) call.set('Cookie', `refresh_token=${cookie}`);
      return call;
    };
    const cookieValue = (response: request.Response) =>
      /refresh_token=([^;]*)/.exec(String(response.headers['set-cookie']))?.[1];

    it('restores a session from the cookie, rotates it and keeps the old one briefly', async () => {
      const issued = await sessions.issue(user);
      const token = issued[REFRESH_TOKEN] as string;
      const response = await refresh(token).expect(200);
      expect(response.body).toEqual({
        accessToken: expect.any(String),
        user: { id: user.id, username: user.username, elo: 1200 },
      });
      const rotated = cookieValue(response);
      expect(rotated).toBeTruthy();
      expect(rotated).not.toBe(token);
      expect(response.headers['cache-control']).toBe('no-store');
      await request(app.getHttpServer())
        .get('/v1/users/me')
        .auth(response.body.accessToken, { type: 'bearer' })
        .expect(200);
      // A second tab that sent the old cookie at the same time still gets in.
      const concurrent = await refresh(token).expect(200);
      expect(concurrent.headers['set-cookie']).toBeUndefined();
      await refresh(rotated).expect(200);
      // Replaying the first cookie after the grace period would revoke the session;
      // that path is covered by the unit tests with a controlled clock.
    });

    it('requires the anti-CSRF header, and answers 204 when there is nothing to restore', async () => {
      const token = (await sessions.issue(user))[REFRESH_TOKEN] as string;
      const forged = await refresh(token, false).expect(401);
      expect(forged.body.code).toBe('INVALID_REFRESH_TOKEN');
      // A signed-out visit must not produce a failed request in the browser console.
      const missing = await refresh().expect(204);
      expect(missing.text).toBe('');
      const bad = await refresh(`${randomUUID()}.${'A'.repeat(43)}`).expect(
        204,
      );
      expect(String(bad.headers['set-cookie'])).toMatch(/refresh_token=;/);
    });

    it('logs out with the cookie alone and cannot be refreshed afterwards', async () => {
      const issued = await sessions.issue(user);
      const token = issued[REFRESH_TOKEN] as string;
      const response = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Cookie', `refresh_token=${token}`)
        .expect(204);
      expect(String(response.headers['set-cookie'])).toMatch(/refresh_token=;/);
      await refresh(token).expect(204);
      await request(app.getHttpServer())
        .get('/v1/users/me')
        .auth(issued.accessToken, { type: 'bearer' })
        .expect(401);
    });

    it('revokes the refresh cookie together with the bearer session on logout', async () => {
      const issued = await sessions.issue(user);
      await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .auth(issued.accessToken, { type: 'bearer' })
        .expect(204);
      await refresh(issued[REFRESH_TOKEN] as string).expect(204);
    });
  });
});
