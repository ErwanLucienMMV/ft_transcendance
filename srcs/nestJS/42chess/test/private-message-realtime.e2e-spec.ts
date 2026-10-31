import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import WebSocket from 'ws';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { Message } from '../dist/messages/messages.entity.js';
import { SessionService } from '../dist/auth/session.service.js';
import { PresenceService } from '../dist/presence/presence.service.js';

interface Packet {
  event: string;
  data: Record<string, unknown>;
}
class Inbox {
  readonly packets: Packet[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      const bytes = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
      this.packets.push(JSON.parse(bytes.toString('utf8')) as Packet);
    });
  }
  send(event: string, data: unknown) {
    this.socket.send(JSON.stringify({ event, data }));
  }
  async take(event: string): Promise<Packet> {
    let index = -1;
    await vi.waitFor(
      () => {
        index = this.packets.findIndex((packet) => packet.event === event);
        expect(
          index,
          `Expected ${event}, received ${JSON.stringify(this.packets)}`,
        ).toBeGreaterThanOrEqual(0);
      },
      { timeout: 2000, interval: 10 },
    );
    return this.packets.splice(index, 1)[0];
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, 'close');
    this.socket.terminate();
    await closed;
  }
}

// Spec §22: SEND_PRIVATE_MESSAGE addresses an account, not an ephemeral room.
// Real sessions, actual sockets, and real PostgreSQL are used throughout.
describe('Durable private messaging over the shared WebSocket (SCRUM-256)', () => {
  let app: INestApplication,
    source: DataSource,
    sessions: SessionService,
    url: string;
  let alice: User, bob: User, outsider: User;
  const clients: Inbox[] = [];

  async function start() {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.listen(0, '127.0.0.1');
    source = app.get(DataSource);
    sessions = app.get(SessionService);
    url = (await app.getUrl()).replace('http:', 'ws:') + '/ws';
  }
  beforeAll(async () => {
    await start();
    const suffix = randomUUID().slice(0, 8);
    [alice, bob, outsider] = await source.getRepository(User).save(
      ['alice', 'bob', 'outsider'].map((name) => ({
        username: `pmws_${name}_${suffix}`,
        emailVerifiedAt: new Date(),
      })),
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await vi.waitFor(() => {
      for (const user of [alice, bob, outsider])
        expect(app.get(PresenceService).isOnline(user.id)).toBe(false);
    });
    await source.query('DELETE FROM messages WHERE "senderId" = ANY($1)', [
      [alice.id, bob.id, outsider.id],
    ]);
  });
  afterAll(async () => {
    if (source?.isInitialized && alice)
      await source.getRepository(User).delete([alice.id, bob.id, outsider.id]);
    await app?.close();
  });
  async function open() {
    const client = new Inbox(new WebSocket(url));
    clients.push(client);
    await once(client.socket, 'open');
    return client;
  }
  async function connect(user: User, token?: string) {
    const client = await open();
    client.send('AUTHENTICATE', {
      accessToken: token ?? (await sessions.issue(user)).accessToken,
    });
    expect(await client.take('AUTHENTICATED')).toEqual({
      event: 'AUTHENTICATED',
      data: { userId: user.id },
    });
    return client;
  }
  async function history(user: User, peer: User) {
    return (
      await request(app.getHttpServer())
        .get(`/v1/conversations/${peer.id}/messages`)
        .auth((await sessions.issue(user)).accessToken, { type: 'bearer' })
        .expect(200)
    ).body;
  }
  async function stored() {
    return source.getRepository(Message).findBy({ senderId: alice.id });
  }

  it('delivers the same committed spec message to both accounts and all their tabs without joining a room', async () => {
    const sender = await connect(alice),
      senderTab = await connect(alice);
    const recipient = await connect(bob),
      recipientTab = await connect(bob);
    const other = await connect(outsider);
    sender.send('SEND_PRIVATE_MESSAGE', {
      receiverId: bob.id,
      content: '  Hello ♟️\nBob!  ',
    });
    const first = await sender.take('PRIVATE_MESSAGE');
    expect(first.data).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      senderId: alice.id,
      receiverId: bob.id,
      content: '  Hello ♟️\nBob!  ',
      createdAt: expect.any(String),
    });
    for (const client of [senderTab, recipient, recipientTab])
      expect(await client.take('PRIVATE_MESSAGE')).toEqual(first);
    const [row] = await stored();
    expect(row).toMatchObject({
      id: first.data.id,
      content: first.data.content,
      readAt: null,
    });
    expect((await history(bob, alice)).messages).toEqual([first.data]);
    expect(
      other.packets.filter((packet) => packet.event === 'PRIVATE_MESSAGE'),
    ).toEqual([]);
  });

  it('keeps offline messages across disconnects and a complete server restart', async () => {
    const sender = await connect(alice);
    sender.send('SEND_PRIVATE_MESSAGE', {
      receiverId: bob.id,
      content: 'Read me tomorrow',
    });
    const sent = await sender.take('PRIVATE_MESSAGE');
    await sender.close();
    await app.close();
    await start();
    await connect(bob);
    expect((await history(bob, alice)).messages).toEqual([sent.data]);
    expect(await stored()).toHaveLength(1);
    const conversations = await request(app.getHttpServer())
      .get('/v1/conversations')
      .auth((await sessions.issue(bob)).accessToken, { type: 'bearer' })
      .expect(200);
    expect(conversations.body).toEqual({
      conversations: [
        {
          user: { id: alice.id, username: alice.username },
          lastMessage: sent.data,
          unreadCount: 1,
        },
      ],
    });
  });

  it('rejects spoofed authors, invalid recipients and invalid content without saving or broadcasting', async () => {
    const sender = await connect(alice),
      recipient = await connect(bob);
    const invalid = [
      { receiverId: bob.id, content: 'fake', senderId: outsider.id },
      { receiverId: bob.id, content: 'fake', id: randomUUID() },
      {
        receiverId: bob.id,
        content: 'fake',
        createdAt: new Date().toISOString(),
      },
      { receiverId: bob.id, content: '' },
      { receiverId: bob.id, content: ' \n ' },
      { receiverId: bob.id, content: 'a'.repeat(2001) },
      { receiverId: bob.id, content: null },
      { receiverId: bob.id, content: 'bad\0message' },
      { receiverId: bob.id },
      { receiverId: alice.id.toUpperCase(), content: 'self' },
      { receiverId: randomUUID(), content: 'missing' },
      { receiverId: 'invalid', content: 'invalid' },
      { content: 'missing receiver' },
    ];
    for (const data of invalid) {
      sender.send('SEND_PRIVATE_MESSAGE', data);
      expect((await sender.take('ERROR')).data.statusCode).toBe(
        data.content === 'missing' ? 404 : 400,
      );
    }
    expect(await stored()).toEqual([]);
    expect(
      recipient.packets.filter((packet) => packet.event === 'PRIVATE_MESSAGE'),
    ).toEqual([]);
  });

  it('emits no success when saving fails and remains usable for the next valid send', async () => {
    const sender = await connect(alice),
      recipient = await connect(bob);
    const save = vi
      .spyOn(source.getRepository(Message), 'save')
      .mockRejectedValueOnce(new Error('simulated database outage'));
    sender.send('SEND_PRIVATE_MESSAGE', {
      receiverId: bob.id,
      content: 'must not be announced',
    });
    expect((await sender.take('ERROR')).data.statusCode).toBe(500);
    expect(
      sender.packets.filter((packet) => packet.event === 'PRIVATE_MESSAGE'),
    ).toEqual([]);
    expect(
      recipient.packets.filter((packet) => packet.event === 'PRIVATE_MESSAGE'),
    ).toEqual([]);
    expect(await stored()).toEqual([]);
    save.mockRestore();
    sender.send('SEND_PRIVATE_MESSAGE', {
      receiverId: bob.id,
      content: 'saved now',
    });
    const sent = await sender.take('PRIVATE_MESSAGE');
    expect(await recipient.take('PRIVATE_MESSAGE')).toEqual(sent);
    expect(await stored()).toHaveLength(1);
  });

  it('reports USER_NOT_FOUND if the recipient is deleted between validation and persistence', async () => {
    const sender = await connect(alice),
      recipient = await connect(bob);
    const users = source.getRepository(User);
    const disappearing = await users.save({
      username: `pmws_deleted_${randomUUID().slice(0, 8)}`,
      emailVerifiedAt: new Date(),
    });
    const existsBy = users.existsBy.bind(users);
    const check = vi
      .spyOn(users, 'existsBy')
      .mockImplementationOnce(async (where) => {
        const exists = await existsBy(where);
        // Delete only this test's fresh account, after the real existence query.
        await users.delete(disappearing.id);
        return exists;
      });
    try {
      sender.send('SEND_PRIVATE_MESSAGE', {
        receiverId: disappearing.id,
        content: 'must not be accepted',
      });
      expect(await sender.take('ERROR')).toEqual({
        event: 'ERROR',
        data: {
          statusCode: 404,
          code: 'USER_NOT_FOUND',
          message: 'User not found.',
        },
      });
      expect(check).toHaveBeenCalledWith({ id: disappearing.id });
      expect(await stored()).toEqual([]);
      expect(
        sender.packets.filter((packet) => packet.event === 'PRIVATE_MESSAGE'),
      ).toEqual([]);
      expect(
        recipient.packets.filter(
          (packet) => packet.event === 'PRIVATE_MESSAGE',
        ),
      ).toEqual([]);
      check.mockRestore();
      sender.send('SEND_PRIVATE_MESSAGE', {
        receiverId: bob.id,
        content: 'still usable',
      });
      const sent = await sender.take('PRIVATE_MESSAGE');
      expect(await recipient.take('PRIVATE_MESSAGE')).toEqual(sent);
      expect(await stored()).toHaveLength(1);
    } finally {
      check.mockRestore();
      await users.delete(disappearing.id);
    }
  });

  it('revalidates receiving sessions and preserves delivery to another valid session of the same user', async () => {
    const sender = await connect(alice);
    const { accessToken } = await sessions.issue(bob);
    const revoked = await connect(bob, accessToken),
      active = await connect(bob);
    const { sessionId } = await sessions.authenticate(accessToken);
    await sessions.revoke(sessionId, bob.id);
    sender.send('SEND_PRIVATE_MESSAGE', {
      receiverId: bob.id,
      content: 'private after logout',
    });
    const sent = await sender.take('PRIVATE_MESSAGE');
    expect(await active.take('PRIVATE_MESSAGE')).toEqual(sent);
    expect(
      revoked.packets.filter((packet) => packet.event === 'PRIVATE_MESSAGE'),
    ).toEqual([]);
    expect((await history(bob, alice)).messages).toEqual([sent.data]);
  });

  it('requires authentication and refuses a revoked sender without persisting anything', async () => {
    const anonymous = await open();
    anonymous.send('SEND_PRIVATE_MESSAGE', {
      receiverId: bob.id,
      content: 'anonymous',
    });
    expect((await anonymous.take('ERROR')).data.statusCode).toBe(401);
    const { accessToken } = await sessions.issue(alice);
    const sender = await connect(alice, accessToken);
    const { sessionId } = await sessions.authenticate(accessToken);
    await sessions.revoke(sessionId, alice.id);
    sender.send('SEND_PRIVATE_MESSAGE', {
      receiverId: bob.id,
      content: 'revoked',
    });
    expect((await sender.take('ERROR')).data.statusCode).toBe(401);
    expect(await stored()).toEqual([]);
  });
});
