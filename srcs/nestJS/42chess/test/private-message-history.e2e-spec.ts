import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { sessionToken } from './session.fixture.js';
import { PrivateMessagesService } from '../dist/chat/private-messages.service.js';

// Spec §22 and SCRUM-249/252/253/254: history belongs to the two account
// holders, persists independently of sockets, and supports bounded paging.
describe('Persistent private conversation HTTP contract', () => {
  let app: INestApplication, source: DataSource;
  let alice: User, bob: User, carol: User, outsider: User;
  let aliceToken: string, bobToken: string, outsiderToken: string;
  const ids: string[] = [];
  const idPrefix = randomUUID().slice(0, 24);
  const timestamp = '2026-10-01T12:00:00.000Z';

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.init();
    source = app.get(DataSource);
    const suffix = randomUUID().slice(0, 8);
    [alice, bob, carol, outsider] = await source.getRepository(User).save(
      ['alice', 'bob', 'carol', 'outsider'].map((name) => ({
        username: `pm_${name}_${suffix}`,
        email: `${name}_${suffix}@example.test`,
        passwordHash: 'must-never-leak',
        emailVerifiedAt: new Date(),
      })),
    );
    aliceToken = await sessionToken(app, alice.id);
    bobToken = await sessionToken(app, bob.id);
    outsiderToken = await sessionToken(app, outsider.id);
    // Equal timestamps deliberately force a stable secondary ordering.
    for (let index = 1; index <= 25; index++) {
      const id = `${idPrefix}${String(index).padStart(12, '0')}`;
      ids.push(id);
      await source.query(
        `INSERT INTO messages(id,"senderId","recipientId",content,"createdAt","readAt")
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          id,
          index % 2 ? alice.id : bob.id,
          index % 2 ? bob.id : alice.id,
          `Message ${index}`,
          timestamp,
          index === 2 ? timestamp : null,
        ],
      );
    }
    await source.query(
      `INSERT INTO messages("senderId","recipientId",content,"createdAt")
       VALUES ($1,$2,'other conversation','2026-10-02T12:00:00Z'),
              ($1,$3,'private elsewhere','2026-10-03T12:00:00Z')`,
      [carol.id, alice.id, outsider.id],
    );
  });

  afterAll(async () => {
    if (source?.isInitialized && alice) {
      const users = [alice, bob, carol, outsider].map((user) => user.id);
      await source.query(
        'DELETE FROM messages WHERE "senderId" = ANY($1) OR "recipientId" = ANY($1)',
        [users],
      );
      await source.getRepository(User).delete(users);
    }
    await app?.close();
  });

  const history = (peer: string, token = aliceToken) =>
    request(app.getHttpServer())
      .get(`/v1/conversations/${peer}/messages`)
      .auth(token, { type: 'bearer' });

  it('returns persisted messages in both directions, newest first, with the spec fields only', async () => {
    const response = await history(bob.id).expect(200);
    expect(response.body).toMatchObject({ total: 25, limit: 20, offset: 0 });
    expect(response.body.messages.map((row: { id: string }) => row.id)).toEqual(
      ids.slice(5).reverse(),
    );
    expect(response.body.messages[0]).toEqual({
      id: ids[24],
      senderId: alice.id,
      receiverId: bob.id,
      content: 'Message 25',
      createdAt: timestamp,
    });
    const reverse = await history(alice.id, bobToken).expect(200);
    expect(reverse.body).toEqual(response.body);
    expect(JSON.stringify(response.body)).not.toMatch(
      /readAt|recipientId|password|@example/,
    );
  });

  it('pages without overlap or omissions when timestamps tie and reports empty pages', async () => {
    const collected: string[] = [];
    for (let offset = 0; offset < 25; offset += 7) {
      const response = await history(bob.id)
        .query({ limit: 7, offset })
        .expect(200);
      expect(response.body).toMatchObject({ total: 25, limit: 7, offset });
      collected.push(
        ...response.body.messages.map((row: { id: string }) => row.id),
      );
    }
    expect(collected).toEqual([...ids].reverse());
    await history(bob.id).query({ offset: 100 }).expect(200, {
      messages: [],
      total: 25,
      limit: 20,
      offset: 100,
    });
  });

  it('lists one conversation per peer, newest first, with incoming-only unread counts', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/conversations')
      .auth(aliceToken, { type: 'bearer' })
      .expect(200);
    expect(response.body).toEqual({
      conversations: [
        {
          user: { id: carol.id, username: carol.username },
          lastMessage: {
            id: expect.any(String),
            senderId: carol.id,
            receiverId: alice.id,
            content: 'other conversation',
            createdAt: '2026-10-02T12:00:00.000Z',
          },
          unreadCount: 1,
        },
        {
          user: { id: bob.id, username: bob.username },
          lastMessage: {
            id: ids[24],
            senderId: alice.id,
            receiverId: bob.id,
            content: 'Message 25',
            createdAt: timestamp,
          },
          unreadCount: 11,
        },
      ],
    });
    // Merely fetching history must not silently mark incoming messages read.
    await history(bob.id).expect(200);
    const again = await request(app.getHttpServer())
      .get('/v1/conversations')
      .auth(aliceToken, { type: 'bearer' })
      .expect(200);
    expect(again.body).toEqual(response.body);
  });

  it('never lets an outsider retrieve another pair by supplying a peer ID', async () => {
    await history(bob.id, outsiderToken).expect(200, {
      messages: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    await history(bob.id, outsiderToken)
      .query({ senderId: alice.id })
      .expect(400);
  });

  it('requires a real session and validates peers and pagination', async () => {
    for (const path of [
      '/v1/conversations',
      `/v1/conversations/${bob.id}/messages`,
    ]) {
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer())
        .get(path)
        .auth(alice.id, { type: 'bearer' })
        .expect(401);
    }
    await history(randomUUID()).expect(404);
    await history('invalid').expect(400);
    await history(alice.id).expect(400);
    for (const query of [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { offset: -1 },
      { offset: 'x' },
    ])
      await history(bob.id).query(query).expect(400);
  });

  it('commits offline messages with their original content and server-owned IDs before returning', async () => {
    const content = '  Bonjour ♟️\nThis is durable, not an IRC room.  ';
    const before = Date.now();
    const saved = await app
      .get(PrivateMessagesService)
      .send(carol.id, outsider.id, content);
    expect(saved).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      senderId: carol.id,
      receiverId: outsider.id,
      content,
      createdAt: expect.any(String),
    });
    expect(Date.parse(saved.createdAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(saved.createdAt)).toBeLessThanOrEqual(Date.now() + 1000);
    // A new connection cannot see an uncommitted row or any process-local cache.
    const independent = new DataSource(source.options);
    await independent.initialize();
    try {
      const [row] = await independent.query(
        'SELECT * FROM messages WHERE id = $1',
        [saved.id],
      );
      expect(row).toMatchObject({
        senderId: carol.id,
        recipientId: outsider.id,
        content,
        readAt: null,
      });
      const response = await history(carol.id, outsiderToken).expect(200);
      expect(response.body.messages[0]).toEqual(saved);
    } finally {
      await independent.destroy();
    }
  });

  it('rejects invalid messages without inserting anything and accepts the storage length boundary', async () => {
    const service = app.get(PrivateMessagesService);
    const [{ count: before }] = await source.query(
      'SELECT count(*)::int FROM messages',
    );
    for (const content of [
      '',
      ' \n\t ',
      'a'.repeat(2001),
      null,
      12,
      'bad\0text',
    ])
      await expect(
        service.send(carol.id, outsider.id, content),
      ).rejects.toThrow();
    for (const receiver of [
      carol.id,
      carol.id.toUpperCase(),
      randomUUID(),
      'invalid',
      null,
    ])
      await expect(service.send(carol.id, receiver, 'hello')).rejects.toThrow();
    const [{ count: after }] = await source.query(
      'SELECT count(*)::int FROM messages',
    );
    expect(after).toBe(before);
    const boundary = '♟'.repeat(2000);
    expect((await service.send(carol.id, outsider.id, boundary)).content).toBe(
      boundary,
    );
    // PostgreSQL counts Unicode code points, including supplementary characters.
    const emoji = '😀'.repeat(2000);
    expect((await service.send(carol.id, outsider.id, emoji)).content).toBe(
      emoji,
    );
  });
});
