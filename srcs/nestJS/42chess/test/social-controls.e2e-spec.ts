import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import WebSocket from 'ws';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { SessionService } from '../dist/auth/session.service.js';

interface Packet {
  event: string;
  data: Record<string, unknown>;
}

class Inbox {
  readonly packets: Packet[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw: Buffer) =>
      this.packets.push(JSON.parse(raw.toString('utf8')) as Packet),
    );
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
  count(event: string) {
    return this.packets.filter((packet) => packet.event === event).length;
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, 'close');
    this.socket.terminate();
    await closed;
  }
}

// Blocking, "friends only", crossed and withdrawn requests, read receipts, typing and
// the live events that keep the friends and messages pages current.
describe('Social controls and live social events', () => {
  let app: INestApplication, source: DataSource, url: string;
  const users: User[] = [];
  const tokens = new Map<string, string>();
  const clients: Inbox[] = [];
  const timeControl = { initialTime: 180000, increment: 2000 };

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.listen(0, '127.0.0.1');
    source = app.get(DataSource);
    url = (await app.getUrl()).replace('http:', 'ws:') + '/ws';
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  afterAll(async () => {
    if (source?.isInitialized && users.length) {
      const ids = users.map((user) => user.id);
      await source.query(
        `DELETE FROM game_messages WHERE "gameId" IN (SELECT "gameId" FROM game_players WHERE "userId" = ANY($1))`,
        [ids],
      );
      await source.query(
        `DELETE FROM games WHERE id IN (SELECT "gameId" FROM game_players WHERE "userId" = ANY($1))`,
        [ids],
      );
      await source.query(
        'DELETE FROM messages WHERE "senderId" = ANY($1) OR "recipientId" = ANY($1)',
        [ids],
      );
      await source.query(
        'DELETE FROM friend_requests WHERE "senderId" = ANY($1) OR "recipientId" = ANY($1)',
        [ids],
      );
      await source.query(
        'DELETE FROM friendships WHERE "userId" = ANY($1) OR "friendId" = ANY($1)',
        [ids],
      );
      await source.getRepository(User).delete(ids);
    }
    await app?.close();
  });

  async function player(): Promise<User> {
    const saved = await source.getRepository(User).save({
      username: `social_${randomUUID().slice(0, 12)}`,
      emailVerifiedAt: new Date(),
    });
    users.push(saved);
    tokens.set(
      saved.id,
      (await app.get(SessionService).issue(saved)).accessToken,
    );
    return saved;
  }

  async function connect(user: User): Promise<Inbox> {
    const client = new Inbox(new WebSocket(url));
    clients.push(client);
    await once(client.socket, 'open');
    client.send('AUTHENTICATE', { accessToken: tokens.get(user.id) });
    await client.take('AUTHENTICATED');
    return client;
  }

  function as(user: User) {
    const call = (
      method: 'get' | 'post' | 'put' | 'delete' | 'patch',
      path: string,
    ) =>
      request(app.getHttpServer())
        [method](path)
        .auth(tokens.get(user.id)!, { type: 'bearer' });
    return {
      block: (target: User) => call('put', `/v1/blocks/${target.id}`),
      unblock: (target: User) => call('delete', `/v1/blocks/${target.id}`),
      blocks: () => call('get', '/v1/blocks'),
      befriend: (target: User) =>
        call('post', '/v1/friends/requests').send({ recipientId: target.id }),
      accept: (id: string) => call('post', `/v1/friends/requests/${id}/accept`),
      dismiss: (id: string) => call('delete', `/v1/friends/requests/${id}`),
      friends: () => call('get', '/v1/friends'),
      challenge: (target: User) =>
        call('post', '/v1/games').send({ opponentId: target.id, timeControl }),
      game: (id: string) => call('get', `/v1/games/${id}`),
      read: (peer: User) => call('post', `/v1/conversations/${peer.id}/read`),
      preferences: (preferences: Record<string, unknown>) =>
        call('patch', '/v1/users/me').send({ preferences }),
    };
  }

  async function befriend(first: User, second: User) {
    await source.query(
      `INSERT INTO friendships ("userId", "friendId") VALUES ($1, $2)`,
      [first.id, second.id].sort(),
    );
  }

  async function message(from: Inbox, to: User, content = 'hello') {
    from.send('SEND_PRIVATE_MESSAGE', { receiverId: to.id, content });
  }

  it('blocking ends the friendship, pending requests and open challenges, then stops every contact both ways', async () => {
    const [alice, bob, carol] = await Promise.all([
      player(),
      player(),
      player(),
    ]);
    await befriend(alice, bob);
    const challenge = (await as(bob).challenge(alice).expect(201)).body
      .gameId as string;
    const pending = (await as(carol).befriend(alice).expect(201)).body;
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);
    const carolSocket = await connect(carol);

    await as(alice).block(bob).expect(204);
    expect((await bobSocket.take('FRIEND_REMOVED')).data).toEqual({
      userId: alice.id,
    });
    expect((await aliceSocket.take('FRIEND_REMOVED')).data).toEqual({
      userId: bob.id,
    });
    expect((await as(alice).friends().expect(200)).body.friends).toEqual([]);
    await as(bob).game(challenge).expect(404);

    // Blocking a player with a pending request removes it on both screens.
    await as(alice).block(carol).expect(204);
    expect((await carolSocket.take('FRIEND_REQUEST_REMOVED')).data).toEqual({
      requestId: pending.id,
    });
    expect((await aliceSocket.take('FRIEND_REQUEST_REMOVED')).data).toEqual({
      requestId: pending.id,
    });

    const list = (await as(alice).blocks().expect(200)).body.users;
    expect(list.map((row: { id: string }) => row.id).sort()).toEqual(
      [bob.id, carol.id].sort(),
    );
    expect(list[0]).toEqual({
      id: expect.any(String),
      username: expect.any(String),
      avatarUrl: null,
      blockedAt: expect.any(String),
    });
    expect((await as(bob).blocks().expect(200)).body).toEqual({ users: [] });

    for (const [actor, target] of [
      [bob, alice],
      [alice, bob],
    ]) {
      expect((await as(actor).befriend(target).expect(403)).body.code).toBe(
        'USER_BLOCKED',
      );
      expect((await as(actor).challenge(target).expect(403)).body.code).toBe(
        'USER_BLOCKED',
      );
    }
    await message(bobSocket, alice);
    expect((await bobSocket.take('ERROR')).data).toMatchObject({
      statusCode: 403,
      code: 'USER_BLOCKED',
    });
    await message(aliceSocket, bob);
    expect((await aliceSocket.take('ERROR')).data).toMatchObject({
      code: 'USER_BLOCKED',
      message: expect.stringContaining('Unblock'),
    });
    expect(aliceSocket.count('PRIVATE_MESSAGE')).toBe(0);

    // Idempotent, never oneself, never an unknown player.
    await as(alice).block(bob).expect(204);
    expect((await as(alice).block(alice).expect(400)).body.code).toBe(
      'BLOCK_SELF',
    );
    await as(alice)
      .block({ id: randomUUID() } as User)
      .expect(404);
    await as(alice)
      .block({ id: 'invalid' } as User)
      .expect(400);
    await request(app.getHttpServer()).get('/v1/blocks').expect(401);

    await as(alice).unblock(bob).expect(204);
    await as(alice).unblock(bob).expect(204);
    await as(bob).befriend(alice).expect(201);
    await message(bobSocket, alice, 'friends again?');
    expect((await aliceSocket.take('PRIVATE_MESSAGE')).data.content).toBe(
      'friends again?',
    );
  });

  it('lets a player hear only from friends, while still accepting friend requests', async () => {
    const [shy, stranger, friend] = await Promise.all([
      player(),
      player(),
      player(),
    ]);
    await befriend(shy, friend);
    expect(
      (await as(shy).preferences({ messagesFromFriendsOnly: true }).expect(200))
        .body.preferences.messagesFromFriendsOnly,
    ).toBe(true);
    const strangerSocket = await connect(stranger);
    const friendSocket = await connect(friend);

    await message(strangerSocket, shy);
    expect((await strangerSocket.take('ERROR')).data).toMatchObject({
      statusCode: 403,
      code: 'FRIENDS_ONLY',
    });
    expect((await as(stranger).challenge(shy).expect(403)).body.code).toBe(
      'FRIENDS_ONLY',
    );
    await message(friendSocket, shy, 'hi friend');
    expect((await friendSocket.take('PRIVATE_MESSAGE')).data.content).toBe(
      'hi friend',
    );
    await as(friend).challenge(shy).expect(201);
    // The shy player can still write first.
    const shySocket = await connect(shy);
    await message(shySocket, stranger, 'hello stranger');
    expect((await strangerSocket.take('PRIVATE_MESSAGE')).data.content).toBe(
      'hello stranger',
    );

    const asked = (await as(stranger).befriend(shy).expect(201)).body;
    await as(shy).accept(asked.id).expect(200);
    await message(strangerSocket, shy, 'now we are friends');
    expect((await strangerSocket.take('PRIVATE_MESSAGE')).data.content).toBe(
      'now we are friends',
    );
  });

  it('announces requests, answers, friendships and challenges live', async () => {
    const [alice, bob] = await Promise.all([player(), player()]);
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);

    const first = (await as(alice).befriend(bob).expect(201)).body;
    expect((await bobSocket.take('FRIEND_REQUEST_RECEIVED')).data).toEqual({
      request: first,
      sender: {
        id: alice.id,
        username: alice.username,
        avatarUrl: null,
        elo: expect.any(Number),
        // Set when the socket connected.
        lastSeenAt: expect.any(String),
      },
    });
    expect((await aliceSocket.take('FRIEND_REQUEST_SENT')).data).toEqual({
      request: first,
    });

    // Withdrawn by the sender: gone on both sides, and it can be sent again at once.
    await as(alice).dismiss(first.id).expect(204);
    for (const socket of [aliceSocket, bobSocket])
      expect((await socket.take('FRIEND_REQUEST_REMOVED')).data).toEqual({
        requestId: first.id,
      });
    const second = (await as(alice).befriend(bob).expect(201)).body;
    await bobSocket.take('FRIEND_REQUEST_RECEIVED');

    // Bob asks too: that is a yes, and both get the other as a friend.
    const crossed = (await as(bob).befriend(alice).expect(201)).body;
    expect(crossed).toEqual({ ...second, status: 'ACCEPTED' });
    const [toAlice, toBob] = await Promise.all([
      aliceSocket.take('FRIEND_ADDED'),
      bobSocket.take('FRIEND_ADDED'),
    ]);
    expect(toAlice.data).toMatchObject({
      requestId: second.id,
      friend: { id: bob.id, username: bob.username, status: 'ONLINE' },
    });
    expect(toBob.data).toMatchObject({
      friend: { id: alice.id, username: alice.username, status: 'ONLINE' },
    });

    const game = (await as(bob).challenge(alice).expect(201)).body
      .gameId as string;
    expect((await aliceSocket.take('CHALLENGE_RECEIVED')).data).toEqual({
      gameId: game,
      from: {
        id: bob.id,
        username: bob.username,
        avatarUrl: null,
        elo: expect.any(Number),
      },
      initialTime: timeControl.initialTime,
      increment: timeControl.increment,
      rated: false,
    });
    expect(bobSocket.count('CHALLENGE_RECEIVED')).toBe(0);
  });

  it('tells the sender when messages are read and when the other player is typing', async () => {
    const [alice, bob] = await Promise.all([player(), player()]);
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);

    await message(aliceSocket, bob, 'are you there?');
    const sent = (await aliceSocket.take('PRIVATE_MESSAGE')).data;
    expect(sent.readAt).toBeNull();
    await bobSocket.take('PRIVATE_MESSAGE');

    await as(bob).read(alice).expect(204);
    for (const socket of [aliceSocket, bobSocket])
      expect((await socket.take('MESSAGES_READ')).data).toEqual({
        readerId: bob.id,
        senderId: alice.id,
        readAt: expect.any(String),
        messageIds: [sent.id],
      });
    // Nothing new to read: no event.
    await as(bob).read(alice).expect(204);

    bobSocket.send('TYPING', { receiverId: alice.id });
    expect((await aliceSocket.take('TYPING')).data).toEqual({
      userId: bob.id,
    });
    // At most one hint every two seconds; malformed hints are dropped without an error.
    bobSocket.send('TYPING', { receiverId: alice.id });
    bobSocket.send('TYPING', { receiverId: 'invalid' });
    bobSocket.send('TYPING', { receiverId: alice.id, extra: true });
    bobSocket.send('TYPING', { receiverId: bob.id });
    await message(bobSocket, alice, 'yes');
    await aliceSocket.take('PRIVATE_MESSAGE');
    expect(aliceSocket.count('TYPING')).toBe(0);
    expect(aliceSocket.count('MESSAGES_READ')).toBe(0);
    expect(bobSocket.count('ERROR')).toBe(0);

    // A blocked player's hints never arrive.
    await as(alice).block(bob).expect(204);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    bobSocket.send('TYPING', { receiverId: alice.id });
    await message(bobSocket, alice, 'blocked');
    await bobSocket.take('ERROR');
    expect(aliceSocket.count('TYPING')).toBe(0);
  });
});
