import { randomUUID, createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';

describe('SCRUM-95 current user (real JWT and PostgreSQL)', () => {
  let app: INestApplication<App>;
  let source: DataSource;
  let user: User;
  const jwt = new JwtService();
  const secret = process.env.JWT_SECRET!;
  const sign = (sub: string, options = {}) =>
    jwt.signAsync(
      { sub },
      {
        secret,
        algorithm: 'HS256',
        expiresIn: 60,
        ...options,
      },
    );
  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    source = app.get(DataSource);
    user = await source.getRepository(User).save({
      username: `me_${randomUUID().slice(0, 8)}`,
      email: `me_${randomUUID()}@example.com`,
      emailVerifiedAt: new Date(),
      passwordHash: 'private-password',
      twoFactorSecret: 'private-totp',
      emailVerificationTokenHash: 'private-token',
    });
  });
  afterAll(async () => {
    if (user) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  it('returns the complete spec profile for the token subject, without secrets', async () => {
    const stored = await source
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    const response = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${await sign(user.id)}`)
      .expect(200);
    expect(response.body).toEqual({
      id: user.id,
      username: user.username,
      avatarUrl: null,
      elo: 1200,
      gamesPlayed: 0,
      gamesWon: 0,
      gamesDraw: 0,
      gamesLost: 0,
      createdAt: stored.createdAt.toISOString(),
      preferences: { language: 'en', theme: 'system', soundEnabled: true },
    });
  });
  it('rejects missing, forged, expired and invalid-subject tokens', async () => {
    const invalid = [
      undefined,
      user.id,
      await sign(user.id, { secret: 'wrong-key' }),
      await sign(user.id, { expiresIn: -1 }),
      await sign('not-a-uuid'),
    ];
    for (const token of invalid) {
      const call = request(app.getHttpServer()).get('/v1/users/me');
      if (token) call.set('Authorization', `Bearer ${token}`);
      expect((await call.expect(401)).body.code).toBe('AUTH_REQUIRED');
    }
  });
  it('never accepts a signed 2FA challenge as a completed login', async () => {
    const key = createHmac('sha256', secret)
      .update('2fa-challenge')
      .digest('base64url');
    const token = await jwt.signAsync(
      { sub: user.id, typ: '2fa-challenge' },
      {
        secret: key,
        algorithm: 'HS256',
        expiresIn: 60,
      },
    );
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
  it('does not return an arbitrary account for a deleted token subject', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${await sign(randomUUID())}`)
      .expect(404);
    expect(response.body.code).toBe('USER_NOT_FOUND');
  });
});
