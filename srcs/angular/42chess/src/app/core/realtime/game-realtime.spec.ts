import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AuthSession } from '../auth/auth-session';
import { GameRealtime } from './game-realtime';
import { RealtimeService, ServerEvent, SOCKET_FACTORY, SOCKET_URL } from './realtime.service';

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
describe('View-independent game adapter', () => {
  let service: GameRealtime;
  let session: AuthSession;
  let events: Subject<ServerEvent>;
  let transport: {
    state: ReturnType<typeof signal<string>>;
    events: unknown;
    connect: ReturnType<typeof vi.fn>;
    joinGame: ReturnType<typeof vi.fn>;
    leaveGame: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    events = new Subject();
    transport = {
      state: signal('connected'),
      events: events.asObservable(),
      connect: vi.fn(),
      joinGame: vi.fn(() => true),
      leaveGame: vi.fn(() => true),
      send: vi.fn(() => true),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: RealtimeService, useValue: transport }],
    });
    session = TestBed.inject(AuthSession);
    service = TestBed.inject(GameRealtime);
    session.establish({
      user: { id: 'player', username: 'Ta2b', elo: 1000 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
    TestBed.tick();
  });
  afterEach(() => {
    session.clear();
    events.complete();
  });
  function snapshot(gameId = id) {
    events.next({
      event: 'GAME_STATE',
      data: {
        id: gameId,
        gameId,
        status: 'ACTIVE',
        board: { fen: 'authoritative-fen', turn: 'WHITE' },
        moves: [],
        clocks: { white: 1000, black: 1000 },
      },
    });
  }
  it('subscribes after connecting and ignores unrelated snapshots', () => {
    expect(service.watch(id)).toBe(true);
    TestBed.tick();
    expect(transport.joinGame).toHaveBeenCalledWith(id);
    snapshot(other);
    expect(service.game()).toBeNull();
    snapshot();
    expect(service.game()?.board.fen).toBe('authoritative-fen');
  });
  it('waits for an active authoritative snapshot before sending commands', () => {
    service.watch(id);
    TestBed.tick();
    expect(service.move('e2', 'e4')).toBe(false);
    snapshot();
    expect(service.move('e2', 'e4')).toBe(true);
    expect(transport.send).toHaveBeenCalledWith('MAKE_MOVE', {
      gameId: id,
      from: 'e2',
      to: 'e4',
      promotion: null,
    });
    for (const [action, event] of [
      [() => service.resign(), 'RESIGN'],
      [() => service.offerDraw(), 'OFFER_DRAW'],
      [() => service.acceptDraw(), 'ACCEPT_DRAW'],
      [() => service.declineDraw(), 'DECLINE_DRAW'],
    ] as const) {
      expect(action()).toBe(true);
      expect(transport.send).toHaveBeenCalledWith(event, { gameId: id });
    }
  });
  it('does not repeat subscription commands when the transport reconnects itself', () => {
    service.watch(id);
    TestBed.tick();
    transport.state.set('reconnecting');
    TestBed.tick();
    transport.state.set('connected');
    TestBed.tick();
    expect(transport.joinGame).toHaveBeenCalledTimes(1);
  });
  it('updates only authoritative clock values and clears data when leaving', () => {
    service.watch(id);
    TestBed.tick();
    snapshot();
    events.next({
      event: 'CLOCK_UPDATE',
      data: { gameId: id, clocks: { white: 900, black: 1000 } },
    });
    expect(service.game()?.clocks?.white).toBe(900);
    service.leave();
    expect(transport.leaveGame).toHaveBeenCalledWith(id);
    expect(service.game()).toBeNull();
  });
  it('compensates a clock round trip and keeps terminal clocks frozen', () => {
    let now = 100;
    const timer = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      service.watch(id);
      TestBed.tick();
      const data = {
        id,
        gameId: id,
        status: 'ACTIVE',
        board: { fen: 'server-fen', turn: 'WHITE' },
        moves: [],
        clocks: { white: 5000, black: 6000 },
        serverTime: '2026-10-28T10:00:00.000Z',
        clockStatus: 'RUNNING',
      };
      events.next({ event: 'GAME_STATE', data });
      expect(transport.send).toHaveBeenCalledWith('SYNC_CLOCK', { gameId: id, requestId: 1 });
      now = 400;
      events.next({
        event: 'CLOCK_SYNC',
        data: { ...data, turn: 'WHITE', requestId: 1, processingMs: 100, sampleAgeMs: 50 },
      });
      expect(service.displayClocks()).toEqual({ white: 4850, black: 6000 });
      expect(service.game()?.clocks).toEqual({ white: 5000, black: 6000 });
      events.next({
        event: 'GAME_STATE',
        data: {
          ...data,
          status: 'FINISHED',
          clockStatus: 'STOPPED',
          clocks: { white: 4800, black: 6000 },
          serverTime: '2026-10-28T10:00:00.200Z',
        },
      });
      events.next({ event: 'CLOCK_UPDATE', data: { ...data, turn: 'WHITE' } });
      expect(service.displayClocks()).toEqual({ white: 4800, black: 6000 });
      expect(service.game()?.status).toBe('FINISHED');
    } finally {
      timer.mockRestore();
    }
  });
  it('reports errors without changing a previously received board', () => {
    service.watch(id);
    TestBed.tick();
    snapshot();
    events.next({ event: 'ERROR', data: { code: 'INVALID_MOVE', message: 'raw server text' } });
    expect(service.error()?.code).toBe('INVALID_MOVE');
    expect(service.error()?.message).not.toContain('raw server');
    expect(service.game()?.board.fen).toBe('authoritative-fen');
  });
  it('refuses invalid identifiers and removes game data when the session expires', () => {
    expect(service.watch('bad-id')).toBe(false);
    service.watch(id);
    TestBed.tick();
    snapshot();
    session.clear();
    TestBed.tick();
    expect(service.game()).toBeNull();
    expect(service.watch(id)).toBe(false);
  });
});

class FakeSocket {
  readyState = 0;
  onopen?: () => void;
  onmessage?: (message: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  send = vi.fn();
  close = vi.fn();
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  packet(event: string, data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ event, data }) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
  events() {
    return this.send.mock.calls.map(([value]) => JSON.parse(value));
  }
}

describe('Game adapter across session changes', () => {
  let service: GameRealtime;
  let session: AuthSession;
  let sockets: FakeSocket[];
  let renewals = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: SOCKET_URL, useValue: () => 'wss://example.com/ws' },
        {
          provide: SOCKET_FACTORY,
          useValue: () => {
            const socket = new FakeSocket();
            sockets.push(socket);
            return socket;
          },
        },
      ],
    });
    session = TestBed.inject(AuthSession);
    service = TestBed.inject(GameRealtime);
  });
  afterEach(() => {
    session.clear();
    TestBed.tick();
    vi.useRealTimers();
  });
  function establish(userId: string) {
    session.establish({
      user: { id: userId, username: userId, elo: 1000 },
      accessToken: `x.${btoa(
        JSON.stringify({ sub: userId, jti: ++renewals, exp: Math.floor(Date.now() / 1000) + 3600 }),
      )}.x`,
    });
  }
  function authenticate(userId: string) {
    sockets.at(-1)!.open();
    sockets.at(-1)!.packet('AUTHENTICATED', { userId });
    TestBed.tick();
  }
  function aliceWatching() {
    establish('alice');
    TestBed.tick();
    expect(service.watch(id)).toBe(true);
    TestBed.tick();
    authenticate('alice');
    sockets[0].packet('GAME_STATE', {
      id,
      gameId: id,
      status: 'ACTIVE',
      board: { fen: 'alice-fen', turn: 'WHITE' },
      moves: [],
    });
    expect(service.game()?.board.fen).toBe('alice-fen');
    expect(sockets[0].events().map((packet) => packet.event)).toEqual([
      'AUTHENTICATE',
      'JOIN_GAME',
    ]);
  }

  it('rejoins the watched game after the same user renews the token', () => {
    aliceWatching();
    establish('alice');
    TestBed.tick();
    expect(sockets[0].close).toHaveBeenCalled();
    authenticate('alice');
    expect(sockets[1].events()).toEqual([
      { event: 'AUTHENTICATE', data: { accessToken: session.token() } },
      { event: 'JOIN_GAME', data: { gameId: id } },
    ]);
  });
  it('discards the previous account game when another account replaces the session', () => {
    aliceWatching();
    establish('bob');
    TestBed.tick();
    expect(service.game()).toBeNull();
    authenticate('bob');
    expect(sockets[1].events().map((packet) => packet.event)).toEqual(['AUTHENTICATE']);
    expect(service.move('e2', 'e4')).toBe(false);
  });
  it('subscribes the new account when it watches before the session effect runs', () => {
    aliceWatching();
    establish('bob');
    expect(service.watch(id)).toBe(true);
    expect(service.game()).toBeNull();
    TestBed.tick();
    authenticate('bob');
    expect(sockets).toHaveLength(2);
    expect(sockets[1].events().map((packet) => packet.event)).toEqual([
      'AUTHENTICATE',
      'JOIN_GAME',
    ]);
  });
  it('clears game data on logout or expiry', () => {
    aliceWatching();
    session.clear('Your session expired. Please sign in again.');
    TestBed.tick();
    vi.advanceTimersByTime(10000);
    expect(service.game()).toBeNull();
    expect(sockets).toHaveLength(1);
  });
  it('sends one subscription after an ordinary reconnect with the same token', () => {
    aliceWatching();
    sockets[0].drop();
    TestBed.tick();
    vi.advanceTimersByTime(500);
    authenticate('alice');
    expect(sockets[1].events().map((packet) => packet.event)).toEqual([
      'AUTHENTICATE',
      'JOIN_GAME',
    ]);
  });
});
