import { AuthSession } from '../../dist/auth/auth-session.entity.js';
import { SessionService } from '../../dist/auth/session.service.js';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import cliDataSource from '../../dist/database/data-source.js';
import { FriendsModule } from '../../dist/friends/friends.module.js';
import { Friendship } from '../../dist/friends/friendships.entity.js';
import { FriendRequest } from '../../dist/friends/friend-requests.entity.js';
import { User } from '../../dist/users/user.entity.js';

describe('Friends list HTTP (real PostgreSQL and bearer authentication)', () => {
  let app: INestApplication<App>;
  let source: DataSource;
  let actor: User, lower: User, higher: User, pending: User, rejected: User;
  let empty: User, unverified: User;
  const ids = Array.from({ length: 7 }, () => randomUUID()).sort();
  const jwt = new JwtService();
  const tokens = new Map<string, string>();
  const lastSeenAt = new Date('2026-01-01T12:30:00.000Z');
  function token(id: string, extra: Record<string, unknown> = {}) {
    return jwt.sign(
      { ...(jwt.decode(tokens.get(id) ?? '') ?? { sub: id }), ...extra },
      {
        secret: process.env.JWT_SECRET,
        algorithm: 'HS256',
        ...(tokens.has(id) ? {} : { expiresIn: 60 }),
      },
    );
  }
  function list(id: string = actor.id) {
    return request(app.getHttpServer())
      .get('/v1/friends')
      .set('Authorization', `Bearer ${token(id)}`);
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_EXPIRES_IN: 3600 })],
        }),
        TypeOrmModule.forRoot({
          ...cliDataSource.options,
          entities: [User, Friendship, FriendRequest, AuthSession],
          migrationsRun: true,
        }),
        FriendsModule,
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    source = app.get(DataSource);
    const users = source.getRepository(User);
    [lower, actor, higher, pending, rejected, empty, unverified] =
      await users.save(
        ids.map((id, index) =>
          users.create({
            id,
            username: `friend_${id.slice(0, 16)}`,
            email: `${id}@test.dev`,
            passwordHash: 'never-public',
            twoFactorSecret: 'never-public',
            emailVerifiedAt: index === 6 ? null : new Date(),
            avatarUrl: index === 0 ? 'https://example.com/avatar.png' : null,
            lastSeenAt: index === 0 ? lastSeenAt : null,
          }),
        ),
      );
    for (const user of [
      lower,
      actor,
      higher,
      pending,
      rejected,
      empty,
      unverified,
    ])
      tokens.set(
        user.id,
        (await app.get(SessionService).issue(user)).accessToken,
      );
    const friendships = source.getRepository(Friendship);
    await friendships.save([
      friendships.create({
        userId: lower.id,
        friendId: actor.id,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
      friendships.create({
        userId: actor.id,
        friendId: higher.id,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      }),
      friendships.create({ userId: pending.id, friendId: rejected.id }),
    ]);
    const requests = source.getRepository(FriendRequest);
    await requests.save([
      requests.create({ senderId: pending.id, recipientId: actor.id }),
      requests.create({
        senderId: actor.id,
        recipientId: rejected.id,
        status: 'REJECTED',
      }),
    ]);
  });

  afterAll(async () => {
    if (source?.isInitialized) {
      await source.query(
        'DELETE FROM friend_requests WHERE "senderId" = ANY($1::uuid[])',
        [ids],
      );
      await source.query(
        'DELETE FROM friendships WHERE "userId" = ANY($1::uuid[])',
        [ids],
      );
      await source.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    }
    await app?.close();
  });

  it('lists both canonical directions, omitting requests and unrelated relationships', async () => {
    const response = await list().expect(200);
    expect(response.body).toEqual({
      friends: [
        {
          id: lower.id,
          username: lower.username,
          avatarUrl: lower.avatarUrl,
          elo: lower.elo,
          lastSeenAt: lastSeenAt.toISOString(),
          status: 'OFFLINE',
        },
        {
          id: higher.id,
          username: higher.username,
          avatarUrl: null,
          elo: higher.elo,
          lastSeenAt: null,
          status: 'OFFLINE',
        },
      ],
    });
    const serialized = JSON.stringify(response.body);
    for (const privateField of [
      'email',
      'passwordHash',
      'twoFactorSecret',
      'emailVerifiedAt',
    ])
      expect(serialized).not.toContain(privateField);
    expect((await list().expect(200)).body).toEqual(response.body);
  });

  it('returns an empty collection for an account with no accepted relationships', async () => {
    expect((await list(empty.id).expect(200)).body).toEqual({ friends: [] });
  });

  it('derives the owner from the signed token despite forged query and headers', async () => {
    const response = await list()
      .query({ userId: empty.id, actorId: empty.id })
      .set('X-User-Id', empty.id)
      .expect(200);
    expect(
      response.body.friends.map((friend: { id: string }) => friend.id),
    ).toEqual([lower.id, higher.id]);
  });

  it('rejects missing, forged, expired, challenge, and deleted-account credentials', async () => {
    await request(app.getHttpServer()).get('/v1/friends').expect(401);
    for (const bearer of [
      actor.id,
      `${token(actor.id)}corrupted`,
      token(actor.id, { typ: '2fa' }),
      token(randomUUID()),
      jwt.sign(
        { sub: actor.id },
        { secret: process.env.JWT_SECRET, expiresIn: -1 },
      ),
    ]) {
      const response = await request(app.getHttpServer())
        .get('/v1/friends')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
    }
  });

  it('rejects unverified accounts before returning friend information', async () => {
    const response = await list(unverified.id).expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });
  it('rejects a revoked session immediately without returning the friend list', async () => {
    const accessToken = (await app.get(SessionService).issue(actor))
      .accessToken;
    await request(app.getHttpServer())
      .get('/v1/friends')
      .set('Authorization', 'Bearer ' + accessToken)
      .expect(200);
    const claims = jwt.decode<{ jti: string }>(accessToken);
    await app.get(SessionService).revoke(claims.jti, actor.id);
    const response = await request(app.getHttpServer())
      .get('/v1/friends')
      .set('Authorization', 'Bearer ' + accessToken)
      .expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(response.body.friends).toBeUndefined();
  });
});
