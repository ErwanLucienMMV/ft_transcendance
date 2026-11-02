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
import { GameMessage } from '../dist/messages/game-messages.entity.js';

interface Packet {
  event: string;
  data: Record<string, unknown>;
}
class Inbox {
  readonly packets: Packet[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      const bytes = Array.isArray(raw)
        ? Buffer.concat(raw)
        : raw instanceof ArrayBuffer
          ? Buffer.from(raw)
          : raw;
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
      { timeout: 3000, interval: 10 },
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

// Spec §21, with real sessions, sockets, engine and PostgreSQL.
describe('Game chat (SCRUM-261 to 267)', () => {
  let app: INestApplication, source: DataSource, sessions: SessionService;
  let url: string;
  let alice: User, bob: User, carol: User;
  const clients: Inbox[] = [];
  const games: string[] = [];

  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    process.env.BOT_ENGINE_URL =
      process.env.TEST_BOT_ENGINE_URL ?? 'ws://127.0.0.1:55434';
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await app.listen(0, '127.0.0.1');
    source = app.get(DataSource);
    sessions = app.get(SessionService);
    url = (await app.getUrl()).replace('http:', 'ws:') + '/ws';
    const suffix = randomUUID().slice(0, 8);
    [alice, bob, carol] = await source.getRepository(User).save(
      ['alice', 'bob', 'carol'].map((name) => ({
        username: `gc_${name}_${suffix}`,
        emailVerifiedAt: new Date(),
      })),
    );
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    for (const id of games.splice(0)) {
      await source.query('DELETE FROM game_messages WHERE "gameId" = $1', [id]);
      await source.query('DELETE FROM moves WHERE "gameId" = $1', [id]);
      await source.query('DELETE FROM rating_history WHERE "gameId" = $1', [
        id,
      ]);
      await source.query('DELETE FROM game_players WHERE "gameId" = $1', [id]);
      await source.query('DELETE FROM games WHERE id = $1', [id]);
    }
  });
  afterAll(async () => {
    if (source?.isInitialized && alice)
      await source.getRepository(User).delete([alice.id, bob.id, carol.id]);
    await app?.close();
  });

  async function connect(user: User) {
    const client = new Inbox(new WebSocket(url));
    clients.push(client);
    await once(client.socket, 'open');
    client.send('AUTHENTICATE', {
      accessToken: (await sessions.issue(user)).accessToken,
    });
    await client.take('AUTHENTICATED');
    return client;
  }
  async function token(user: User) {
    return (await sessions.issue(user)).accessToken;
  }
  /** Alice and Bob seated and playing, Carol watching. */
  async function table() {
    const created = await request(app.getHttpServer())
      .post('/v1/games')
      .auth(await token(alice), { type: 'bearer' })
      .send({ timeControl: { initialTime: 600000, increment: 0 } })
      .expect(201);
    const gameId = created.body.gameId as string;
    games.push(gameId);
    const [white, black, watcher] = await Promise.all([
      connect(alice),
      connect(bob),
      connect(carol),
    ]);
    white.send('JOIN_GAME', { gameId });
    await white.take('GAME_STATE');
    black.send('JOIN_GAME', { gameId });
    await black.take('GAME_STATE');
    watcher.send('START_SPECTATING', { gameId });
    await watcher.take('GAME_STATE');
    return { gameId, white, black, watcher };
  }

  it('delivers the committed spec message to players and spectators', async () => {
    const { gameId, white, black, watcher } = await table();
    white.send('SEND_GAME_MESSAGE', { gameId, content: 'Good luck! 👋' });
    const { data } = await black.take('GAME_MESSAGE');
    expect(data).toEqual({
      id: expect.any(String),
      gameId,
      sender: { id: alice.id, username: alice.username },
      content: 'Good luck! 👋',
      createdAt: expect.any(String),
    });
    expect((await watcher.take('GAME_MESSAGE')).data).toEqual(data);
    expect((await white.take('GAME_MESSAGE')).data).toEqual(data);
    const row = await source
      .getRepository(GameMessage)
      .findOneByOrFail({ id: data.id as string });
    expect(row).toMatchObject({ gameId, userId: alice.id });
  });

  it('lets a spectator write, and refuses anyone outside the room', async () => {
    const { gameId, white, watcher } = await table();
    watcher.send('SEND_GAME_MESSAGE', { gameId, content: 'Nice opening' });
    const { data } = await white.take('GAME_MESSAGE');
    expect(data.sender).toEqual({ id: carol.id, username: carol.username });

    const outsider = await connect(bob);
    outsider.send('SEND_GAME_MESSAGE', { gameId, content: 'Not in the room' });
    expect((await outsider.take('ERROR')).data.code).toBe('ROOM_REQUIRED');
  });

  it('never stores blank, oversized or spoofed messages', async () => {
    const { gameId, white } = await table();
    for (const content of ['   ', 'x'.repeat(2001), 42, 'a\0b']) {
      white.send('SEND_GAME_MESSAGE', { gameId, content });
      expect((await white.take('ERROR')).data.statusCode).toBe(400);
    }
    white.send('SEND_GAME_MESSAGE', { gameId, content: 'x', userId: bob.id });
    expect((await white.take('ERROR')).data.statusCode).toBe(400);
    expect(await source.getRepository(GameMessage).countBy({ gameId })).toBe(0);

    // The limit counts code points, as the column does: 2000 emoji fit.
    white.send('SEND_GAME_MESSAGE', { gameId, content: '👋'.repeat(2000) });
    await white.take('GAME_MESSAGE');
  });

  it('closes the chat when the game ends, and keeps the history readable', async () => {
    const { gameId, white, black, watcher } = await table();
    white.send('SEND_GAME_MESSAGE', { gameId, content: 'Before the end' });
    await black.take('GAME_MESSAGE');
    black.send('RESIGN', { gameId });
    await white.take('GAME_ENDED');

    for (const client of [white, watcher]) {
      client.packets.length = 0;
      client.send('SEND_GAME_MESSAGE', { gameId, content: 'Too late' });
      expect((await client.take('ERROR')).data.code).toBe(
        'GAME_ALREADY_FINISHED',
      );
    }
    const history = await request(app.getHttpServer())
      .get(`/v1/games/${gameId}/messages`)
      .auth(await token(carol), { type: 'bearer' })
      .expect(200);
    expect(history.body).toMatchObject({ total: 1, limit: 20, offset: 0 });
    expect(history.body.messages[0]).toMatchObject({
      gameId,
      sender: { id: alice.id, username: alice.username },
      content: 'Before the end',
    });
  });

  it('says which command an error answers', async () => {
    const { gameId, white } = await table();
    white.send('SEND_GAME_MESSAGE', { gameId, content: '   ' });
    expect((await white.take('ERROR')).data.event).toBe('SEND_GAME_MESSAGE');
    white.send('RESIGN', { gameId: randomUUID() });
    expect((await white.take('ERROR')).data.event).toBeUndefined();
  });

  it('starts a challenge only while its creator is there', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/games')
      .auth(await token(alice), { type: 'bearer' })
      .send({
        timeControl: { initialTime: 600000, increment: 0 },
        opponentId: bob.id,
      })
      .expect(201);
    const gameId = created.body.gameId as string;
    games.push(gameId);
    const invited = await connect(bob);
    invited.send('JOIN_GAME', { gameId });
    expect((await invited.take('ERROR')).data.code).toBe('OPPONENT_AWAY');

    const creator = await connect(alice);
    creator.send('JOIN_GAME', { gameId });
    await creator.take('GAME_STATE');
    invited.send('JOIN_GAME', { gameId });
    expect((await invited.take('GAME_STATE')).data.status).toBe('ACTIVE');
  });

  it('pages the history newest first, for signed-in users only', async () => {
    const { gameId, white } = await table();
    for (const content of ['one', 'two', 'three']) {
      white.send('SEND_GAME_MESSAGE', { gameId, content });
      await white.take('GAME_MESSAGE');
    }
    const page = await request(app.getHttpServer())
      .get(`/v1/games/${gameId}/messages?limit=2&offset=0`)
      .auth(await token(bob), { type: 'bearer' })
      .expect(200);
    expect(page.body.total).toBe(3);
    expect(
      page.body.messages.map((item: { content: string }) => item.content),
    ).toEqual(['three', 'two']);
    await request(app.getHttpServer())
      .get(`/v1/games/${gameId}/messages`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/v1/games/${randomUUID()}/messages`)
      .auth(await token(bob), { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .get('/v1/games/not-a-uuid/messages')
      .auth(await token(bob), { type: 'bearer' })
      .expect(400);
  });
});
