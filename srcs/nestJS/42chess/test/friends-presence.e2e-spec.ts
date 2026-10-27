import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sessionToken } from './session.fixture.js';
import { DataSource } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { WebSocket } from 'ws';
import { AppModule } from '../dist/app.module.js';
import { User } from '../dist/users/user.entity.js';
import { GamesService } from '../dist/games/games.service.js';
import { PresenceService } from '../dist/presence/presence.service.js';
import { PresenceGateway } from '../dist/presence/presence.gateway.js';

describe('SCRUM-247 private friend-list presence synchronization', () => {
  let app: INestApplication<App>,
    source: DataSource,
    presence: PresenceService,
    gateway: PresenceGateway,
    games: GamesService,
    url: string;
  let users: User[] = [];
  const clients: WebSocket[] = [],
    owned: string[] = [];
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const token = (id: string) => sessionToken(app, id);
  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.listen(0, '127.0.0.1');
    source = app.get(DataSource);
    presence = app.get(PresenceService);
    gateway = app.get(PresenceGateway);
    games = app.get(GamesService);
    users = await source.getRepository(User).save(
      [
        {
          id: `80000000-0000-4000-8000-${suffix}`,
          username: `owner_${suffix}`,
        },
        {
          id: `10000000-0000-4000-8000-${suffix}`,
          username: `friend_a_${suffix}`,
        },
        {
          id: `f0000000-0000-4000-8000-${suffix}`,
          username: `friend_b_${suffix}`,
        },
        {
          id: `a0000000-0000-4000-8000-${suffix}`,
          username: `outsider_${suffix}`,
        },
      ].map((user) => ({
        ...user,
        emailVerifiedAt: new Date(),
        email: `${user.username}@example.com`,
        passwordHash: 'private-password',
        twoFactorSecret: 'private-totp',
      })),
    );
    for (const friend of users.slice(1, 3)) {
      const pair = [users[0].id, friend.id].sort((a, b) => a.localeCompare(b));
      await source.query(
        'INSERT INTO friendships ("userId", "friendId") VALUES ($1,$2)',
        pair,
      );
    }
    await source.query(
      'INSERT INTO friend_requests ("senderId", "recipientId") VALUES ($1,$2)',
      [users[0].id, users[3].id],
    );
    url = (await app.getUrl()).replace('http:', 'ws:') + '/ws';
  });
  afterEach(async () => {
    for (const id of owned) {
      const state = await games.get(id);
      if (state.game.status === 'ACTIVE')
        await games.resign(state.players[0].userId!, id);
    }
    for (const client of clients.splice(0)) client.terminate();
    await vi.waitFor(() => {
      for (const user of users) expect(presence.isOnline(user.id)).toBe(false);
    });
    await gateway.flushNotifications();
    await presence.flushSeen();
    for (const id of owned.splice(0)) {
      await source.query('DELETE FROM rating_history WHERE "gameId"=$1', [id]);
      await source.query('DELETE FROM games WHERE id=$1', [id]);
    }
  });
  afterAll(async () => {
    if (users[0]) {
      await source.query(
        'DELETE FROM friendships WHERE "userId"=$1 OR "friendId"=$1',
        [users[0].id],
      );
      await source.query(
        'DELETE FROM friend_requests WHERE "senderId"=$1 OR "recipientId"=$1',
        [users[0].id],
      );
    }
    for (const user of users) await source.getRepository(User).delete(user.id);
    await app?.close();
  });
  async function connect(user: User) {
    const client = new WebSocket(url);
    clients.push(client);
    await once(client, 'open');
    const message = once(client, 'message');
    client.send(
      JSON.stringify({
        event: 'AUTHENTICATE',
        data: { accessToken: await token(user.id) },
      }),
    );
    expect(JSON.parse(String((await message)[0])).event).toBe('AUTHENTICATED');
    return client;
  }
  const list = async (id = users[0].id) =>
    (
      await request(app.getHttpServer())
        .get('/v1/friends')
        .set('Authorization', `Bearer ${await token(id)}`)
        .expect(200)
    ).body.friends as {
      id: string;
      username: string;
      elo: number;
      status: string;
    }[];
  it('lists accepted friendships in either stored direction with only public fields', async () => {
    await connect(users[1]);
    expect(await list()).toEqual([
      {
        id: users[1].id,
        username: users[1].username,
        elo: 1200,
        status: 'ONLINE',
      },
      {
        id: users[2].id,
        username: users[2].username,
        elo: 1200,
        status: 'OFFLINE',
      },
    ]);
  });
  it('synchronizes ONLINE, IN_GAME and OFFLINE from real connections and committed game state', async () => {
    const first = await connect(users[1]);
    await connect(users[2]);
    const { game } = await games.create(users[1].id, { initialTime: 300000 });
    owned.push(game.id);
    await games.join(users[2].id, game.id);
    expect((await list()).map((friend) => friend.status)).toEqual([
      'IN_GAME',
      'IN_GAME',
    ]);
    const closed = once(first, 'close');
    first.close();
    await closed;
    await vi.waitFor(async () =>
      expect((await list()).map((friend) => friend.status)).toEqual([
        'OFFLINE',
        'IN_GAME',
      ]),
    );
    await games.resign(users[2].id, game.id);
    expect((await list()).map((friend) => friend.status)).toEqual([
      'OFFLINE',
      'ONLINE',
    ]);
  });
  it('makes a reconnect snapshot agree with online/offline friend events', async () => {
    const owner = await connect(users[0]);
    const online = once(owner, 'message');
    const friend = await connect(users[1]);
    expect(JSON.parse(String((await online)[0]))).toMatchObject({
      event: 'USER_ONLINE',
      data: { userId: users[1].id, status: 'ONLINE' },
    });
    expect((await list())[0].status).toBe('ONLINE');
    const offline = once(owner, 'message'),
      closed = once(friend, 'close');
    friend.close();
    await closed;
    expect(JSON.parse(String((await offline)[0]))).toMatchObject({
      event: 'USER_OFFLINE',
      data: { userId: users[1].id, status: 'OFFLINE' },
    });
    expect((await list())[0].status).toBe('OFFLINE');
  });
  it('shares game rooms and revocable multi-tab presence on the same transport', async () => {
    const accessToken = await token(users[0].id);
    const socket = new WebSocket(url);
    clients.push(socket);
    await once(socket, 'open');
    const handshake = once(socket, 'message');
    socket.send(JSON.stringify({ event: 'AUTHENTICATE', data: { accessToken } }));
    expect(JSON.parse(String((await handshake)[0])).event).toBe('AUTHENTICATED');
    const otherTab = await connect(users[0]);
    const { game } = await games.create(users[0].id, { initialTime: 300000 });
    owned.push(game.id);
    const snapshot = once(socket, 'message');
    socket.send(JSON.stringify({ event: 'JOIN_GAME', data: { gameId: game.id } }));
    expect(JSON.parse(String((await snapshot)[0]))).toMatchObject({ event: 'GAME_STATE', data: { gameId: game.id } });
    const closed = once(socket, 'close');
    await request(app.getHttpServer()).post('/v1/auth/logout').auth(accessToken, { type: 'bearer' }).expect(204);
    await request(app.getHttpServer()).get('/v1/friends').auth(accessToken, { type: 'bearer' }).expect(401);
    expect((await closed)[0]).toBe(4401);
    await vi.waitFor(() => expect(presence.isOnline(users[0].id)).toBe(true));
    const friendOnline = once(otherTab, 'message');
    await connect(users[1]);
    expect(JSON.parse(String((await friendOnline)[0]))).toMatchObject({ event: 'USER_ONLINE', data: { userId: users[1].id } });
  });
  it('authenticates the owner, excludes pending requests, and ignores a forged owner query', async () => {
    await request(app.getHttpServer()).get('/v1/friends').expect(401);
    await request(app.getHttpServer())
      .get('/v1/friends')
      .set('Authorization', `Bearer ${users[0].id}`)
      .expect(401);
    expect(await list(users[3].id)).toEqual([]);
    const response = await request(app.getHttpServer())
      .get('/v1/friends')
      .query({ userId: users[0].id })
      .set('Authorization', `Bearer ${await token(users[3].id)}`)
      .expect(200);
    expect(response.body).toEqual({ friends: [] });
    const deleted = await source
      .getRepository(User)
      .save({ username: 'deleted_' + suffix, emailVerifiedAt: new Date() });
    const deletedToken = await token(deleted.id);
    await source.getRepository(User).delete(deleted.id);
    const missing = await request(app.getHttpServer())
      .get('/v1/friends')
      .set('Authorization', `Bearer ${deletedToken}`)
      .expect(401);
    expect(missing.body.code).toBe('AUTH_REQUIRED');
  });
});
