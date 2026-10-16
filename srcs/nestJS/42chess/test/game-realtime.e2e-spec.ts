import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { UnauthorizedException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import WebSocket from 'ws';
import { AppModule } from '../dist/app.module.js';
import { RealtimeAuthenticator } from '../dist/realtime/realtime-authenticator.js';
import { GamesService } from '../dist/games/games.service.js';
import { User } from '../dist/users/user.entity.js';

interface Packet {
  event: string;
  data: any;
}
class PlayerSocket {
  readonly packets: Packet[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on('message', (data) =>
      this.packets.push(JSON.parse(data.toString())),
    );
  }
  send(event: string, data: unknown) {
    this.socket.send(JSON.stringify({ event, data }));
  }
  async take(
    event: string,
    predicate: (data: any) => boolean = () => true,
  ): Promise<Packet> {
    let index = -1;
    await vi.waitFor(
      () => {
        index = this.packets.findIndex(
          (packet) => packet.event === event && predicate(packet.data),
        );
        expect(
          index,
          `Expected ${event}; received ${this.packets.map((p) => p.event).join(', ')}`,
        ).toBeGreaterThanOrEqual(0);
      },
      { timeout: 4000, interval: 10 },
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

describe('Game WS contract with real PostgreSQL and C++ engine (SCRUM-194/195)', () => {
  let app: INestApplication;
  let source: DataSource;
  let games: GamesService;
  let white: User, black: User, outsider: User;
  let url: string;
  let clients: PlayerSocket[];
  let owned: string[];
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RealtimeAuthenticator)
      .useValue({
        // Only this test module accepts fixture tokens; no production env flag or bypass.
        authenticate: async (token: string) => {
          const userId = tokens.get(token);
          if (!userId)
            throw new UnauthorizedException('Invalid fixture token.');
          return { userId, expiresAt: Date.now() + 60000 };
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/ws`;
    source = app.get(DataSource);
    games = app.get(GamesService);
    const users = source.getRepository(User);
    const suffix = randomUUID().slice(0, 8);
    [white, black, outsider] = await users.save(
      ['white', 'black', 'outside'].map((name) =>
        users.create({
          username: `ws_${name}_${suffix}`,
          emailVerifiedAt: new Date(),
        }),
      ),
    );
    tokens.set('fixture-white', white.id);
    tokens.set('fixture-black', black.id);
    tokens.set('fixture-outsider', outsider.id);
  });
  beforeEach(() => {
    clients = [];
    owned = [];
  });
  afterEach(async () => {
    await Promise.all(clients.map((client) => client.close()));
    for (const id of owned)
      await source.query('DELETE FROM games WHERE id=$1', [id]);
  });
  afterAll(async () => {
    if (source?.isInitialized)
      for (const user of [white, black, outsider])
        if (user)
          await source.query('DELETE FROM users WHERE id=$1', [user.id]);
    await app?.close();
  });
  async function connect(token: string) {
    const socket = new WebSocket(url);
    const client = new PlayerSocket(socket);
    clients.push(client);
    await once(socket, 'open');
    client.send('AUTHENTICATE', { accessToken: token });
    await client.take('AUTHENTICATED');
    return client;
  }
  async function create(initialTime = 300000, increment = 2000) {
    const state = await games.create(white.id, { initialTime, increment });
    owned.push(state.game.id);
    return state.game.id;
  }
  async function active(initialTime = 300000, increment = 2000) {
    const id = await create(initialTime, increment);
    const a = await connect('fixture-white'),
      b = await connect('fixture-black');
    a.send('JOIN_GAME', { gameId: id });
    await a.take('GAME_STATE', (data) => data.status === 'WAITING');
    b.send('JOIN_GAME', { gameId: id });
    await a.take('GAME_STATE', (data) => data.status === 'ACTIVE');
    await b.take('GAME_STATE', (data) => data.status === 'ACTIVE');
    return { id, a, b };
  }

  it('broadcasts a legal move identically to both players with durable SAN/history', async () => {
    const { id, a, b } = await active();
    a.send('MAKE_MOVE', { gameId: id, from: 'e2', to: 'e4', promotion: null });
    const first = await a.take('MOVE_PLAYED'),
      second = await b.take('MOVE_PLAYED');
    expect(first).toEqual(second);
    expect(first.data).toMatchObject({
      gameId: id,
      move: { from: 'e2', to: 'e4', notation: 'e4', playerId: white.id },
      turn: 'BLACK',
    });
    const snapshot = await b.take(
      'GAME_STATE',
      (data) => data.moves.length === 1,
    );
    expect(snapshot.data.board.fen).toBe((await games.get(id)).game.currentFen);
    expect(snapshot.data.moves).toHaveLength(1);
  });
  it('unicasts wrong-turn, illegal-move and forged-actor refusals without changing history', async () => {
    const { id, a, b } = await active();
    b.send('MAKE_MOVE', { gameId: id, from: 'e7', to: 'e5' });
    expect((await b.take('ERROR')).data.code).toBe('NOT_YOUR_TURN');
    a.send('MAKE_MOVE', { gameId: id, from: 'e2', to: 'e5' });
    expect((await a.take('ERROR')).data.code).toBe('INVALID_MOVE');
    a.send('MAKE_MOVE', { gameId: id, from: 'e2', to: 'e4', userId: black.id });
    expect((await a.take('ERROR')).data.statusCode).toBe(400);
    expect((await games.get(id)).moves).toHaveLength(0);
    expect(b.packets.filter((p) => p.event === 'ERROR')).toHaveLength(0);
    expect(a.packets.filter((p) => p.event === 'MOVE_PLAYED')).toHaveLength(0);
  });
  it('refuses outsiders and room-less mutations', async () => {
    const { id } = await active();
    const c = await connect('fixture-outsider');
    c.send('JOIN_GAME', { gameId: id });
    expect((await c.take('ERROR')).data.code).toBe('NOT_A_PLAYER');
    c.send('RESIGN', { gameId: id });
    expect((await c.take('ERROR')).data.code).toBe('ROOM_REQUIRED');
    expect((await games.get(id)).game.status).toBe('ACTIVE');
    expect(c.packets.filter((p) => p.event === 'GAME_STATE')).toHaveLength(0);
  });
  it('recovers the latest persisted board, move history and pending draw after reconnect', async () => {
    const { id, a, b } = await active();
    await b.close();
    a.send('MAKE_MOVE', { gameId: id, from: 'e2', to: 'e4' });
    await a.take('MOVE_PLAYED');
    a.send('OFFER_DRAW', { gameId: id });
    await a.take('DRAW_OFFERED');
    const reconnect = await connect('fixture-black');
    reconnect.send('JOIN_GAME', { gameId: id });
    const snapshot = await reconnect.take('GAME_STATE');
    expect(snapshot.data).toMatchObject({
      status: 'ACTIVE',
      moves: [{ notation: 'e4' }],
      drawOffer: { playerId: white.id },
      board: { turn: 'BLACK' },
    });
    expect(snapshot.data.board.fen).toBe((await games.get(id)).game.currentFen);
    expect((await games.get(id)).players).toHaveLength(2);
    reconnect.send('MAKE_MOVE', { gameId: id, from: 'e7', to: 'e5' });
    await reconnect.take('MOVE_PLAYED');
    expect((await games.get(id)).moves).toHaveLength(2);
  });
  it('leaves without resigning, then rejoins the existing seat', async () => {
    const { id, a } = await active();
    a.send('LEAVE_GAME', { gameId: id });
    await a.take('GAME_LEFT');
    a.send('RESIGN', { gameId: id });
    expect((await a.take('ERROR')).data.code).toBe('ROOM_REQUIRED');
    expect((await games.get(id)).game.status).toBe('ACTIVE');
    a.send('JOIN_GAME', { gameId: id });
    await a.take('GAME_STATE');
    expect((await games.get(id)).players).toHaveLength(2);
  });
  it('offers, declines, then accepts a draw with one terminal publication', async () => {
    const { id, a, b } = await active();
    a.send('OFFER_DRAW', { gameId: id });
    expect((await b.take('DRAW_OFFERED')).data.playerId).toBe(white.id);
    b.send('DECLINE_DRAW', { gameId: id });
    await a.take('DRAW_DECLINED');
    a.send('OFFER_DRAW', { gameId: id });
    await b.take('DRAW_OFFERED');
    b.send('ACCEPT_DRAW', { gameId: id });
    const result = await a.take('GAME_ENDED');
    expect(result.data.result).toEqual({
      winner: null,
      reason: 'DRAW_AGREEMENT',
    });
    expect((await b.take('GAME_ENDED')).data).toEqual(result.data);
    a.send('MAKE_MOVE', { gameId: id, from: 'e2', to: 'e4' });
    await a.take('ERROR');
    expect((await games.get(id)).moves).toHaveLength(0);
  });
  it('persists resignation and restores a terminal result on reconnect', async () => {
    const { id, a, b } = await active();
    a.send('RESIGN', { gameId: id });
    expect((await b.take('GAME_ENDED')).data.result).toEqual({
      winner: 'BLACK',
      reason: 'RESIGNATION',
    });
    await b.close();
    const reconnect = await connect('fixture-black');
    reconnect.send('JOIN_GAME', { gameId: id });
    expect((await reconnect.take('GAME_STATE')).data).toMatchObject({
      status: 'FINISHED',
      result: { winner: 'BLACK', reason: 'RESIGNATION' },
    });
  });
  it('publishes server clocks and settles a real timeout without a fabricated move', async () => {
    const { id, a, b } = await active(1800, 0);
    const clock = await b.take('CLOCK_UPDATE');
    expect(clock.data.clocks.white).toBeLessThan(1800);
    expect(clock.data.clocks.white).toBeGreaterThanOrEqual(0);
    const ended = await a.take('GAME_ENDED');
    expect(ended.data.result).toEqual({ winner: 'BLACK', reason: 'TIMEOUT' });
    expect((await games.get(id)).moves).toHaveLength(0);
    expect(a.packets.filter((p) => p.event === 'MOVE_PLAYED')).toHaveLength(0);
  }, 10000);
});
