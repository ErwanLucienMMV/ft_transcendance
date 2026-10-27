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
import { createValidationPipe } from '../../dist/common/validation.js';
import { FriendsModule } from '../../dist/friends/friends.module.js';
import { Friendship } from '../../dist/friends/friendships.entity.js';
import { FriendRequest } from '../../dist/friends/friend-requests.entity.js';
import { User } from '../../dist/users/user.entity.js';

describe('Send friend request HTTP (real PostgreSQL)', () => {
  let app: INestApplication<App>;
  let source: DataSource;
  const ids: string[] = [];
  const jwt = new JwtService();
  const tokens = new Map<string, string>();

  async function user(verified = true): Promise<User> {
    const id = randomUUID();
    ids.push(id);
    const users = source.getRepository(User);
    const saved = await users.save(
      users.create({
        id,
        username: `send_${id.slice(0, 20)}`,
        email: `${id}@test.dev`,
        passwordHash: 'must-never-leak',
        twoFactorSecret: 'must-never-leak',
        emailVerifiedAt: verified ? new Date() : null,
      }),
    );
    tokens.set(
      saved.id,
      (await app.get(SessionService).issue(saved)).accessToken,
    );
    return saved;
  }

  function token(id: string, claims: Record<string, unknown> = {}) {
    return jwt.sign(
      { ...(jwt.decode(tokens.get(id) ?? '') ?? { sub: id }), ...claims },
      {
        secret: process.env.JWT_SECRET,
        algorithm: 'HS256',
        ...(claims.exp === undefined && !tokens.has(id)
          ? { expiresIn: 60 }
          : {}),
      },
    );
  }

  function send(actor: User, recipient: User) {
    return request(app.getHttpServer())
      .post('/v1/friends/requests')
      .set('Authorization', `Bearer ${token(actor.id)}`)
      .send({ recipientId: recipient.id });
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
    app.useGlobalPipes(createValidationPipe());
    await app.init();
    source = app.get(DataSource);
  });

  afterAll(async () => {
    if (source?.isInitialized) {
      await source.query(
        'DELETE FROM friend_requests WHERE "senderId" = ANY($1::uuid[]) OR "recipientId" = ANY($1::uuid[])',
        [ids],
      );
      await source.query(
        'DELETE FROM friendships WHERE "userId" = ANY($1::uuid[]) OR "friendId" = ANY($1::uuid[])',
        [ids],
      );
      await source.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    }
    await app?.close();
  });

  it('persists a pending request and returns only safe request fields', async () => {
    const [actor, recipient] = await Promise.all([user(), user()]);
    const response = await send(actor, recipient).expect(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      senderId: actor.id,
      recipientId: recipient.id,
      status: 'PENDING',
      createdAt: expect.any(String),
    });
    expect(new Date(response.body.createdAt).toISOString()).toBe(
      response.body.createdAt,
    );
    const persisted = await source
      .getRepository(FriendRequest)
      .findOneByOrFail({ id: response.body.id });
    expect(persisted.senderId).toBe(actor.id);
    expect(persisted.recipientId).toBe(recipient.id);
    expect(persisted.status).toBe('PENDING');
    expect(
      await source.getRepository(Friendship).countBy([
        { userId: actor.id, friendId: recipient.id },
        { userId: recipient.id, friendId: actor.id },
      ]),
    ).toBe(0);
  });

  it('takes the sender from the signed principal despite forged headers and query', async () => {
    const [actor, recipient, outsider] = await Promise.all([
      user(),
      user(),
      user(),
    ]);
    const response = await send(actor, recipient)
      .query({ senderId: outsider.id, userId: outsider.id })
      .set('X-User-Id', outsider.id)
      .expect(201);
    expect(response.body.senderId).toBe(actor.id);
  });

  it('validates recipient UUIDs and forbids supplied sender and status fields', async () => {
    const [actor, recipient] = await Promise.all([user(), user()]);
    for (const body of [
      {},
      { recipientId: null },
      { recipientId: 'invalid' },
      { recipientId: 123 },
      { recipientId: recipient.id, senderId: recipient.id },
      { recipientId: recipient.id, status: 'ACCEPTED' },
    ]) {
      const response = await request(app.getHttpServer())
        .post('/v1/friends/requests')
        .set('Authorization', `Bearer ${token(actor.id)}`)
        .send(body)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }
    expect(
      await source.getRepository(FriendRequest).countBy({ senderId: actor.id }),
    ).toBe(0);
  });

  it('requires valid login credentials and a verified sender', async () => {
    const [actor, recipient, unverified] = await Promise.all([
      user(),
      user(),
      user(false),
    ]);
    await request(app.getHttpServer())
      .post('/v1/friends/requests')
      .send({ recipientId: recipient.id })
      .expect(401);
    for (const bearer of [
      'forged',
      token(randomUUID()),
      token(actor.id, { typ: '2fa' }),
      token(actor.id, { exp: 1 }),
    ]) {
      const response = await request(app.getHttpServer())
        .post('/v1/friends/requests')
        .set('Authorization', `Bearer ${bearer}`)
        .send({ recipientId: recipient.id })
        .expect(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
    }
    expect((await send(unverified, recipient).expect(401)).body.code).toBe(
      'AUTH_REQUIRED',
    );
  });

  it('rejects missing and unverified recipients', async () => {
    const [actor, unverified] = await Promise.all([user(), user(false)]);
    for (const recipient of [unverified, { id: randomUUID() } as User]) {
      expect((await send(actor, recipient).expect(404)).body.code).toBe(
        'USER_NOT_FOUND',
      );
    }
  });

  it('rejects self requests including uppercase UUID spelling', async () => {
    const actor = await user();
    for (const id of [actor.id, actor.id.toUpperCase()]) {
      expect((await send(actor, { id } as User).expect(400)).body.code).toBe(
        'FRIEND_REQUEST_SELF',
      );
    }
    expect(
      await source.getRepository(FriendRequest).countBy({ senderId: actor.id }),
    ).toBe(0);
  });

  it('rejects already accepted friends in either canonical direction', async () => {
    const [first, second] = await Promise.all([user(), user()]);
    const [userId, friendId] = [first.id, second.id].sort();
    await source.getRepository(Friendship).save({ userId, friendId });
    for (const [actor, recipient] of [
      [first, second],
      [second, first],
    ]) {
      expect((await send(actor, recipient).expect(409)).body.code).toBe(
        'ALREADY_FRIENDS',
      );
    }
  });

  it('rejects duplicate and inverse pending requests', async () => {
    const [actor, recipient] = await Promise.all([user(), user()]);
    await send(actor, recipient).expect(201);
    for (const [sender, target] of [
      [actor, recipient],
      [recipient, actor],
    ]) {
      expect((await send(sender, target).expect(409)).body.code).toBe(
        'FRIEND_REQUEST_PENDING',
      );
    }
    expect(
      await source
        .getRepository(FriendRequest)
        .countBy({ senderId: actor.id, recipientId: recipient.id }),
    ).toBe(1);
  });

  it('allows a fresh pending request after a previous rejected request', async () => {
    const [actor, recipient] = await Promise.all([user(), user()]);
    await source.getRepository(FriendRequest).save({
      senderId: recipient.id,
      recipientId: actor.id,
      status: 'REJECTED',
    });
    expect((await send(actor, recipient).expect(201)).body.status).toBe(
      'PENDING',
    );
  });

  it('serializes simultaneous opposite sends into one pending request and conflicts', async () => {
    const [actor, recipient] = await Promise.all([user(), user()]);
    const responses = await Promise.all([
      send(actor, recipient),
      send(recipient, actor),
      send(actor, recipient),
      send(recipient, actor),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409, 409, 409]);
    for (const response of responses.filter(
      (result) => result.status === 409,
    )) {
      expect(response.body.code).toBe('FRIEND_REQUEST_PENDING');
    }
    expect(
      await source.getRepository(FriendRequest).countBy([
        { senderId: actor.id, recipientId: recipient.id, status: 'PENDING' },
        { senderId: recipient.id, recipientId: actor.id, status: 'PENDING' },
      ]),
    ).toBe(1);
  });
});
