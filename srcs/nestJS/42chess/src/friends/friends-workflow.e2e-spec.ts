import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import cliSource from '../../dist/database/data-source.js';
import { createValidationPipe } from '../../dist/common/validation.js';
import { AuthSession } from '../../dist/auth/auth-session.entity.js';
import { SessionService } from '../../dist/auth/session.service.js';
import { FriendsModule } from '../../dist/friends/friends.module.js';
import { Friendship } from '../../dist/friends/friendships.entity.js';
import { FriendRequest } from '../../dist/friends/friend-requests.entity.js';
import { PresenceService } from '../../dist/presence/presence.service.js';
import { User } from '../../dist/users/user.entity.js';

describe('Friends lifecycle, permissions and races (SCRUM-232..237,446)', () => {
  let app: INestApplication<App>, source: DataSource;
  const ids: string[] = [];
  const tokens = new Map<string, string>();

  async function user(verified = true) {
    const id = randomUUID();
    ids.push(id);
    const saved = await source.getRepository(User).save({
      id,
      username: `workflow_${id.slice(0, 16)}`,
      email: `${id}@example.test`,
      passwordHash: 'private-test-value',
      twoFactorSecret: 'private-test-value',
      emailVerifiedAt: verified ? new Date() : null,
    });
    tokens.set(id, (await app.get(SessionService).issue(saved)).accessToken);
    return saved;
  }

  function http(actor: User) {
    return {
      incoming: () =>
        request(app.getHttpServer())
          .get('/v1/friends/requests')
          .auth(tokens.get(actor.id)!, { type: 'bearer' }),
      list: () =>
        request(app.getHttpServer())
          .get('/v1/friends')
          .auth(tokens.get(actor.id)!, { type: 'bearer' }),
      send: (recipient: User) =>
        request(app.getHttpServer())
          .post('/v1/friends/requests')
          .auth(tokens.get(actor.id)!, { type: 'bearer' })
          .send({ recipientId: recipient.id }),
      resolve: (id: string, action = 'reject') =>
        request(app.getHttpServer())
          .post(`/v1/friends/requests/${id}/${action}`)
          .auth(tokens.get(actor.id)!, { type: 'bearer' }),
      remove: (friend: string) =>
        request(app.getHttpServer())
          .delete(`/v1/friends/${friend}`)
          .auth(tokens.get(actor.id)!, { type: 'bearer' }),
    };
  }

  function pair(first: User, second: User) {
    const [userId, friendId] = [first.id, second.id].sort();
    return { userId, friendId };
  }

  async function pending(sender: User, recipient: User, status = 'PENDING') {
    return source
      .getRepository(FriendRequest)
      .save({ senderId: sender.id, recipientId: recipient.id, status });
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
          ...cliSource.options,
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

  it('lists only the signed recipient pending requests in stable order and exposes no private fields', async () => {
    const [owner, first, second, outgoing, accepted, rejected, outsider] =
      await Promise.all(Array.from({ length: 7 }, () => user()));
    const requests = await Promise.all([
      pending(first, owner),
      pending(second, owner),
      pending(owner, outgoing),
      pending(accepted, owner, 'ACCEPTED'),
      pending(rejected, owner, 'REJECTED'),
      pending(first, outsider),
    ]);
    const at = new Date('2026-01-01T00:00:00Z');
    await source
      .getRepository(FriendRequest)
      .update([requests[0].id, requests[1].id], { createdAt: at });
    const response = await http(owner)
      .incoming()
      .query({ userId: outsider.id, recipientId: outsider.id })
      .set('X-User-Id', outsider.id)
      .expect(200);
    expect(response.body).toEqual({
      requests: requests
        .slice(0, 2)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((row) => ({
          id: row.id,
          senderId: row.senderId,
          recipientId: owner.id,
          status: 'PENDING',
          createdAt: at.toISOString(),
        })),
    });
    expect(
      (await http(outgoing).incoming().expect(200)).body.requests,
    ).toHaveLength(1);
    expect((await http(accepted).incoming().expect(200)).body).toEqual({
      requests: [],
    });
  });

  it('runs send -> receive -> reject -> resend -> accept -> remove -> resend without resurrecting history', async () => {
    const [alice, bob] = await Promise.all([user(), user()]);
    const sent = (await http(alice).send(bob).expect(201)).body;
    expect(
      (await http(bob).incoming().expect(200)).body.requests.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual([sent.id]);
    const rejected = await http(bob).resolve(sent.id).expect(200);
    expect(rejected.body).toEqual({ ...sent, status: 'REJECTED' });
    expect((await http(bob).incoming().expect(200)).body).toEqual({
      requests: [],
    });
    expect((await http(alice).list().expect(200)).body).toEqual({
      friends: [],
    });
    const next = (await http(bob).send(alice).expect(201)).body;
    await http(alice).resolve(next.id, 'accept').expect(200);
    expect(
      (await http(bob).list().expect(200)).body.friends.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual([alice.id]);
    const removed = await http(alice).remove(bob.id.toUpperCase()).expect(204);
    expect(removed.text).toBe('');
    for (const actor of [alice, bob])
      expect((await http(actor).list().expect(200)).body).toEqual({
        friends: [],
      });
    await http(alice).resolve(next.id, 'accept').expect(409);
    await http(bob).resolve(sent.id, 'accept').expect(409);
    await http(bob).remove(alice.id).expect(404);
    await http(alice).send(bob).expect(201);
    expect(
      await source.getRepository(FriendRequest).countBy({
        status: 'PENDING',
        senderId: alice.id,
        recipientId: bob.id,
      }),
    ).toBe(1);
    expect(
      await source.getRepository(Friendship).countBy(pair(alice, bob)),
    ).toBe(0);
  });

  it('allows either participant to remove the canonical relationship and keeps unrelated friends intact', async () => {
    for (const index of [0, 1]) {
      const users = (await Promise.all([user(), user(), user()])).sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      const [first, second, third] = users;
      await source
        .getRepository(Friendship)
        .save([pair(first, second), pair(first, third)]);
      await http(users[index])
        .remove(users[1 - index].id)
        .expect(204);
      expect(
        await source.getRepository(Friendship).countBy(pair(first, second)),
      ).toBe(0);
      expect(
        await source.getRepository(Friendship).countBy(pair(first, third)),
      ).toBe(1);
    }
  });

  it('forbids sender and outsiders from rejecting and prevents forged identity from deleting another pair', async () => {
    const [sender, recipient, outsider] = await Promise.all([
      user(),
      user(),
      user(),
    ]);
    const row = await pending(sender, recipient);
    for (const actor of [sender, outsider]) {
      const response = await http(actor)
        .resolve(row.id)
        .set('X-User-Id', recipient.id)
        .query({ userId: recipient.id })
        .send({ recipientId: recipient.id })
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
    await source.getRepository(Friendship).save(pair(sender, recipient));
    expect(
      (
        await http(outsider)
          .remove(recipient.id)
          .set('X-User-Id', sender.id)
          .query({ userId: sender.id })
          .expect(404)
      ).body.code,
    ).toBe('FRIENDSHIP_NOT_FOUND');
    expect(
      await source.getRepository(Friendship).countBy(pair(sender, recipient)),
    ).toBe(1);
  });

  it('validates UUIDs and returns explicit errors for unknown and finalized requests', async () => {
    const [sender, recipient] = await Promise.all([user(), user()]);
    await http(recipient).resolve('invalid').expect(400);
    await http(recipient).remove('invalid').expect(400);
    expect(
      (await http(recipient).resolve(randomUUID()).expect(404)).body.code,
    ).toBe('FRIEND_REQUEST_NOT_FOUND');
    expect(
      (await http(recipient).remove(randomUUID()).expect(404)).body.code,
    ).toBe('FRIENDSHIP_NOT_FOUND');
    for (const status of ['ACCEPTED', 'REJECTED']) {
      const row = await pending(sender, recipient, status);
      expect(
        (await http(recipient).resolve(row.id).expect(409)).body.code,
      ).toBe('FRIEND_REQUEST_FINALIZED');
    }
    const row = await pending(sender, recipient);
    await http(recipient).resolve(row.id.toUpperCase()).expect(200);
    await http(recipient).resolve(row.id).expect(409);
  });

  it('requires verified revocable sessions on all added endpoints', async () => {
    const [sender, recipient, unverified] = await Promise.all([
      user(),
      user(),
      user(false),
    ]);
    const row = await pending(sender, recipient);
    const sessions = app.get(SessionService);
    const revoked = (await sessions.issue(recipient)).accessToken;
    await sessions.revoke(
      new JwtService().decode<{ jti: string }>(revoked).jti,
      recipient.id,
    );
    const expired = new JwtService().sign(
      { sub: recipient.id },
      { secret: process.env.JWT_SECRET, expiresIn: -1 },
    );
    for (const bearer of [
      undefined,
      'forged',
      expired,
      revoked,
      tokens.get(unverified.id),
    ]) {
      for (const [method, path] of [
        ['get', '/v1/friends/requests'],
        ['post', `/v1/friends/requests/${row.id}/reject`],
        ['delete', `/v1/friends/${sender.id}`],
      ] as const) {
        const call = request(app.getHttpServer())[method](path);
        if (bearer) call.auth(bearer, { type: 'bearer' });
        expect((await call.expect(401)).body.code).toBe('AUTH_REQUIRED');
      }
    }
    expect(
      (
        await source
          .getRepository(FriendRequest)
          .findOneByOrFail({ id: row.id })
      ).status,
    ).toBe('PENDING');
  });

  it('serializes concurrent acceptance and rejection into exactly one final state', async () => {
    const [sender, recipient] = await Promise.all([user(), user()]);
    const row = await pending(sender, recipient);
    const results = await Promise.all([
      http(recipient).resolve(row.id, 'accept'),
      http(recipient).resolve(row.id),
      http(recipient).resolve(row.id, 'accept'),
      http(recipient).resolve(row.id),
    ]);
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([200, 409, 409, 409]);
    const saved = await source
      .getRepository(FriendRequest)
      .findOneByOrFail({ id: row.id });
    expect(saved.status).toBe(
      results.find((result) => result.status === 200)!.body.status,
    );
    expect(
      await source.getRepository(Friendship).countBy(pair(sender, recipient)),
    ).toBe(saved.status === 'ACCEPTED' ? 1 : 0);
  });

  it('serializes rejection with opposite sends and leaves at most one new pending request', async () => {
    const [sender, recipient] = await Promise.all([user(), user()]);
    const row = await pending(sender, recipient);
    const [rejected, ...sent] = await Promise.all([
      http(recipient).resolve(row.id),
      http(sender).send(recipient),
      http(recipient).send(sender),
    ]);
    expect(rejected.status).toBe(200);
    expect(
      sent.every((result) => result.status === 201 || result.status === 409),
    ).toBe(true);
    expect(
      sent.filter((result) => result.status === 201).length,
    ).toBeLessThanOrEqual(1);
    const count = await source.getRepository(FriendRequest).countBy([
      { senderId: sender.id, recipientId: recipient.id, status: 'PENDING' },
      { senderId: recipient.id, recipientId: sender.id, status: 'PENDING' },
    ]);
    expect(count).toBe(sent.filter((result) => result.status === 201).length);
    expect(
      await source.getRepository(Friendship).countBy(pair(sender, recipient)),
    ).toBe(0);
  });

  it('serializes opposite removals with sends and never revives an accepted request', async () => {
    const [sender, recipient] = await Promise.all([user(), user()]);
    const row = await pending(sender, recipient);
    await http(recipient).resolve(row.id, 'accept').expect(200);
    const results = await Promise.all([
      http(sender).remove(recipient.id),
      http(recipient).remove(sender.id),
      http(sender).send(recipient),
      http(recipient).send(sender),
      http(recipient).resolve(row.id, 'accept'),
    ]);
    expect(
      results
        .slice(0, 2)
        .map((result) => result.status)
        .sort((a, b) => a - b),
    ).toEqual([204, 404]);
    expect(
      results.slice(2, 4).every((result) => [201, 409].includes(result.status)),
    ).toBe(true);
    expect(results[4].status).toBe(409);
    expect(
      await source.getRepository(Friendship).countBy(pair(sender, recipient)),
    ).toBe(0);
    expect(
      await source.getRepository(FriendRequest).countBy([
        { senderId: sender.id, recipientId: recipient.id, status: 'PENDING' },
        { senderId: recipient.id, recipientId: sender.id, status: 'PENDING' },
      ]),
    ).toBeLessThanOrEqual(1);
  });

  it('rolls back a failed rejection and releases the pair lock for a successful retry', async () => {
    const [sender, recipient] = await Promise.all([user(), user()]);
    const row = await pending(sender, recipient);
    const hook = `reject_failure_${randomUUID().replaceAll('-', '')}`;
    await source.query(`CREATE FUNCTION ${hook}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id = '${row.id}'::uuid THEN RAISE EXCEPTION 'rejection test failure'; END IF; RETURN NEW; END; $$`);
    try {
      await source.query(
        `CREATE TRIGGER ${hook} AFTER UPDATE ON friend_requests FOR EACH ROW EXECUTE FUNCTION ${hook}()`,
      );
      await http(recipient).resolve(row.id).expect(500);
      expect(
        (
          await source
            .getRepository(FriendRequest)
            .findOneByOrFail({ id: row.id })
        ).status,
      ).toBe('PENDING');
    } finally {
      await source.query(`DROP TRIGGER IF EXISTS ${hook} ON friend_requests`);
      await source.query(`DROP FUNCTION ${hook}()`);
    }
    await http(recipient).resolve(row.id).expect(200);
    expect(
      await source.getRepository(Friendship).countBy(pair(sender, recipient)),
    ).toBe(0);
  });

  it('rolls back failed removal and preserves accepted history and presence on retry', async () => {
    const [sender, recipient] = await Promise.all([user(), user()]);
    const row = await pending(sender, recipient);
    await http(recipient).resolve(row.id, 'accept').expect(200);
    const presence = app.get(PresenceService);
    const connection = randomUUID();
    presence.connect(recipient.id, connection);
    const before = presence.get(recipient.id);
    expect((await http(sender).list().expect(200)).body.friends[0].status).toBe(
      'ONLINE',
    );
    const hook = `remove_failure_${randomUUID().replaceAll('-', '')}`;
    await source.query(`CREATE FUNCTION ${hook}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF OLD."userId" = '${pair(sender, recipient).userId}'::uuid THEN RAISE EXCEPTION 'removal test failure'; END IF; RETURN OLD; END; $$`);
    try {
      await source.query(
        `CREATE TRIGGER ${hook} AFTER DELETE ON friendships FOR EACH ROW EXECUTE FUNCTION ${hook}()`,
      );
      await http(sender).remove(recipient.id).expect(500);
      expect(
        await source.getRepository(Friendship).countBy(pair(sender, recipient)),
      ).toBe(1);
    } finally {
      await source.query(`DROP TRIGGER IF EXISTS ${hook} ON friendships`);
      await source.query(`DROP FUNCTION ${hook}()`);
    }
    await http(sender).remove(recipient.id).expect(204);
    expect(presence.get(recipient.id)).toEqual(before);
    expect(
      (
        await source
          .getRepository(FriendRequest)
          .findOneByOrFail({ id: row.id })
      ).status,
    ).toBe('ACCEPTED');
    presence.disconnect(recipient.id, connection);
    await presence.flushSeen();
  });
});
