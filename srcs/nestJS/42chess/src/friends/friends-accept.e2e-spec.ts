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

describe('Accept friend request HTTP (real PostgreSQL)', () => {
  let app: INestApplication<App>;
  let source: DataSource;
  const ids: string[] = [];
  const jwt = new JwtService();

  async function user(verified = true): Promise<User> {
    const id = randomUUID();
    ids.push(id);
    const users = source.getRepository(User);
    return users.save(
      users.create({
        id,
        username: `accept_${id.slice(0, 18)}`,
        email: `${id}@test.dev`,
        passwordHash: 'must-never-leak',
        twoFactorSecret: 'must-never-leak',
        emailVerifiedAt: verified ? new Date() : null,
      }),
    );
  }

  function token(id: string, claims: Record<string, unknown> = {}) {
    return jwt.sign(
      { sub: id, ...claims },
      {
        secret: process.env.JWT_SECRET,
        algorithm: 'HS256',
        ...(claims.exp === undefined ? { expiresIn: 60 } : {}),
      },
    );
  }

  function send(actor: User, recipient: User) {
    return request(app.getHttpServer())
      .post('/v1/friends/requests')
      .set('Authorization', `Bearer ${token(actor.id)}`)
      .send({ recipientId: recipient.id });
  }

  function accept(actor: User, requestId: string) {
    return request(app.getHttpServer())
      .post(`/v1/friends/requests/${requestId}/accept`)
      .set('Authorization', `Bearer ${token(actor.id)}`);
  }

  async function pending(sender: User, recipient: User, status = 'PENDING') {
    return source.getRepository(FriendRequest).save({
      senderId: sender.id,
      recipientId: recipient.id,
      status,
    });
  }

  async function pairCount(first: User, second: User) {
    const [userId, friendId] = [first.id, second.id].sort();
    return source.getRepository(Friendship).countBy({ userId, friendId });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot({
          ...cliDataSource.options,
          entities: [User, Friendship, FriendRequest],
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

  it('accepts atomically, returns a safe DTO and exposes both directions in the friends list', async () => {
    const [sender, recipient] = await Promise.all([user(), user()]);
    const row = await pending(sender, recipient);
    const response = await accept(recipient, row.id).expect(200);
    expect(response.body).toEqual({
      id: row.id,
      senderId: sender.id,
      recipientId: recipient.id,
      status: 'ACCEPTED',
      createdAt: row.createdAt.toISOString(),
    });
    expect(
      (
        await source
          .getRepository(FriendRequest)
          .findOneByOrFail({ id: row.id })
      ).status,
    ).toBe('ACCEPTED');
    expect(await pairCount(sender, recipient)).toBe(1);
    for (const [actor, friend] of [
      [sender, recipient],
      [recipient, sender],
    ]) {
      const listed = await request(app.getHttpServer())
        .get('/v1/friends')
        .set('Authorization', `Bearer ${token(actor.id)}`)
        .expect(200);
      expect(listed.body.friends).toHaveLength(1);
      expect(listed.body.friends[0]).toEqual({
        id: friend.id,
        username: friend.username,
        avatarUrl: null,
        elo: friend.elo,
        lastSeenAt: null,
      });
    }
  });

  it('rejects the sender and outsiders even with forged recipient identity', async () => {
    const [sender, recipient, outsider] = await Promise.all([
      user(),
      user(),
      user(),
    ]);
    const row = await pending(sender, recipient);
    for (const actor of [sender, outsider]) {
      const response = await accept(actor, row.id)
        .set('X-User-Id', recipient.id)
        .query({ userId: recipient.id })
        .send({ recipientId: actor.id })
        .expect(403);
      expect(response.body.code).toBe('FRIEND_REQUEST_FORBIDDEN');
    }
    expect(
      (
        await source
          .getRepository(FriendRequest)
          .findOneByOrFail({ id: row.id })
      ).status,
    ).toBe('PENDING');
    expect(await pairCount(sender, recipient)).toBe(0);
  });

  it('requires authenticated verified recipients and validates the request UUID', async () => {
    const [sender, recipient, unverified] = await Promise.all([
      user(),
      user(),
      user(false),
    ]);
    const row = await pending(sender, recipient);
    await request(app.getHttpServer())
      .post(`/v1/friends/requests/${row.id}/accept`)
      .expect(401);
    for (const bearer of [
      'forged',
      token(randomUUID()),
      token(recipient.id, { typ: '2fa' }),
      token(recipient.id, { exp: 1 }),
    ]) {
      await request(app.getHttpServer())
        .post(`/v1/friends/requests/${row.id}/accept`)
        .set('Authorization', `Bearer ${bearer}`)
        .expect(401);
    }
    const unverifiedRow = await pending(sender, unverified);
    expect(
      (await accept(unverified, unverifiedRow.id).expect(403)).body.code,
    ).toBe('EMAIL_NOT_VERIFIED');
    await accept(recipient, 'invalid').expect(400);
    expect((await accept(recipient, randomUUID()).expect(404)).body.code).toBe(
      'FRIEND_REQUEST_NOT_FOUND',
    );
  });

  it('refuses finalized requests and repeated accepts without another friendship', async () => {
    for (const status of ['ACCEPTED', 'REJECTED']) {
      const [sender, recipient] = await Promise.all([user(), user()]);
      const row = await pending(sender, recipient, status);
      expect((await accept(recipient, row.id).expect(409)).body.code).toBe(
        'FRIEND_REQUEST_FINALIZED',
      );
      expect(await pairCount(sender, recipient)).toBe(0);
    }
    const [sender, recipient] = await Promise.all([user(), user()]);
    const row = await pending(sender, recipient);
    await accept(recipient, row.id.toUpperCase()).expect(200);
    await accept(recipient, row.id).expect(409);
    expect(await pairCount(sender, recipient)).toBe(1);
  });

  it('leaves a pending request unchanged if a friendship already exists', async () => {
    const [sender, recipient] = await Promise.all([user(), user()]);
    const row = await pending(sender, recipient);
    const [userId, friendId] = [sender.id, recipient.id].sort();
    await source.getRepository(Friendship).save({ userId, friendId });
    expect((await accept(recipient, row.id).expect(409)).body.code).toBe(
      'ALREADY_FRIENDS',
    );
    expect(
      (
        await source
          .getRepository(FriendRequest)
          .findOneByOrFail({ id: row.id })
      ).status,
    ).toBe('PENDING');
    expect(await pairCount(sender, recipient)).toBe(1);
  });

  it('serializes simultaneous accepts with opposite sends and creates one friendship', async () => {
    const [sender, recipient] = await Promise.all([user(), user()]);
    const row = await pending(sender, recipient);
    const responses = await Promise.all([
      accept(recipient, row.id),
      accept(recipient, row.id),
      accept(recipient, row.id),
      send(sender, recipient),
      send(recipient, sender),
    ]);
    expect(
      responses.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 409, 409, 409, 409]);
    expect(await pairCount(sender, recipient)).toBe(1);
    expect(
      await source.getRepository(FriendRequest).countBy([
        { senderId: sender.id, recipientId: recipient.id },
        { senderId: recipient.id, recipientId: sender.id },
      ]),
    ).toBe(1);
    expect(
      (
        await source
          .getRepository(FriendRequest)
          .findOneByOrFail({ id: row.id })
      ).status,
    ).toBe('ACCEPTED');
  });

  it('rolls back acceptance when the database rejects friendship insertion', async () => {
    const [sender, recipient] = await Promise.all([user(), user()]);
    const row = await pending(sender, recipient);
    const [userId] = [sender.id, recipient.id].sort();
    // A real database failure after updating the request exercises transaction rollback.
    const suffix = randomUUID().replaceAll('-', '');
    const trigger = `accept_failure_${suffix}`;
    await source.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."userId" = '${userId}'::uuid THEN RAISE EXCEPTION 'accept test insertion failure'; END IF;
        RETURN NEW;
      END; $$`);
    try {
      await source.query(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON friendships FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
      );
      await accept(recipient, row.id).expect(500);
      expect(
        (
          await source
            .getRepository(FriendRequest)
            .findOneByOrFail({ id: row.id })
        ).status,
      ).toBe('PENDING');
      expect(await pairCount(sender, recipient)).toBe(0);
    } finally {
      await source.query(`DROP TRIGGER IF EXISTS ${trigger} ON friendships`);
      await source.query(`DROP FUNCTION ${trigger}()`);
    }
    await accept(recipient, row.id).expect(200);
    expect(await pairCount(sender, recipient)).toBe(1);
  });
});
