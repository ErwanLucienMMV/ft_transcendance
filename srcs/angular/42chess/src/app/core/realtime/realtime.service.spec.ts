import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { AuthSession } from '../auth/auth-session';
import { RealtimeService, SOCKET_FACTORY, SOCKET_URL } from './realtime.service';

class FakeSocket {
  readyState = 0;
  onopen?: () => void;
  onmessage?: (message: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  onerror?: () => void;
  send = vi.fn();
  close = vi.fn();
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  packet(event: string, data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ event, data }) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

describe('Realtime transport', () => {
  let sockets: FakeSocket[];
  let service: RealtimeService;
  let session: AuthSession;
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
    service = TestBed.inject(RealtimeService);
  });
  afterEach(() => {
    service.disconnect();
    session.clear();
    vi.useRealTimers();
  });
  function login() {
    session.establish({
      user: { id: 'player', username: 'Ta2b', elo: 1000 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.x`,
    });
    TestBed.tick();
    service.connect();
  }
  function ready() {
    sockets.at(-1)!.open();
    sockets.at(-1)!.packet('AUTHENTICATED', { userId: 'player' });
  }
  it('does not connect anonymously or send before the authentication acknowledgement', () => {
    service.connect();
    expect(sockets).toHaveLength(0);
    login();
    expect(service.send('MAKE_MOVE', {})).toBe(false);
    sockets[0].open();
    expect(service.state()).toBe('authenticating');
    expect(sockets[0].send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'AUTHENTICATE', data: { accessToken: session.token() } }),
    );
    expect(service.joinGame('game')).toBe(false);
    sockets[0].packet('AUTHENTICATED', { userId: 'player' });
    expect(service.state()).toBe('connected');
    expect(service.joinGame('game')).toBe(true);
  });
  it('reauthenticates and resubscribes after a disconnect without replaying moves', () => {
    login();
    ready();
    service.joinGame('game');
    service.send('MAKE_MOVE', { gameId: 'game', from: 'e2', to: 'e4' });
    sockets[0].drop();
    expect(service.send('RESIGN', { gameId: 'game' })).toBe(false);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    ready();
    const packets = sockets[1].send.mock.calls.map(([value]) => JSON.parse(value));
    expect(packets.map((value) => value.event)).toEqual(['AUTHENTICATE', 'JOIN_GAME']);
  });
  it('cleans connections, retries and joined rooms when the session is cleared', () => {
    login();
    ready();
    service.joinGame('game');
    sockets[0].drop();
    session.clear();
    TestBed.tick();
    vi.advanceTimersByTime(10000);
    expect(sockets).toHaveLength(1);
    expect(service.state()).toBe('disconnected');
    login();
    ready();
    expect(sockets[1].send.mock.calls).toHaveLength(1);
  });
  it('restores a watched room as a spectator after a reconnect', () => {
    login();
    ready();
    service.spectateGame('watched');
    service.joinGame('played');
    expect(sockets[0].send).toHaveBeenCalledWith(
      JSON.stringify({ event: 'START_SPECTATING', data: { gameId: 'watched' } }),
    );
    sockets[0].drop();
    vi.advanceTimersByTime(500);
    ready();
    const packets = sockets[1].send.mock.calls.map(([value]) => JSON.parse(value));
    expect(packets.slice(1)).toEqual([
      { event: 'START_SPECTATING', data: { gameId: 'watched' } },
      { event: 'JOIN_GAME', data: { gameId: 'played' } },
    ]);
    service.stopSpectating('watched');
    expect(sockets[1].send).toHaveBeenLastCalledWith(
      JSON.stringify({ event: 'STOP_SPECTATING', data: { gameId: 'watched' } }),
    );
  });
  it('never resubscribes a room that was left while offline', () => {
    login();
    ready();
    service.joinGame('game');
    sockets[0].drop();
    service.leaveGame('game');
    vi.advanceTimersByTime(500);
    ready();
    expect(sockets[1].send.mock.calls).toHaveLength(1);
  });
  it('stops retrying authentication refusals', () => {
    login();
    sockets[0].drop(4401);
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1);
    expect(service.state()).toBe('unavailable');
  });
  it('bounds unsuccessful reconnect attempts', () => {
    login();
    for (let index = 0; index < 6; index++) {
      sockets.at(-1)!.drop();
      vi.advanceTimersByTime(8000);
    }
    expect(sockets).toHaveLength(6);
    expect(service.state()).toBe('unavailable');
  });
  it('delivers events and rejects malformed or unauthenticated replies', () => {
    login();
    ready();
    const events = vi.fn();
    service.events.subscribe(events);
    sockets[0].packet('CLOCK_UPDATE', { gameId: 'game' });
    expect(events).toHaveBeenCalledWith({ event: 'CLOCK_UPDATE', data: { gameId: 'game' } });
    sockets[0].onmessage?.({ data: 'invalid JSON' });
    expect(sockets[0].close).toHaveBeenCalledWith(4000, 'Invalid response');
  });
  describe('session replacement', () => {
    function establish(userId: string) {
      session.establish({
        user: { id: userId, username: userId, elo: 1000 },
        accessToken: `x.${btoa(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 }))}.x`,
      });
    }
    function sent(socket: FakeSocket) {
      return socket.send.mock.calls.map(([value]) => JSON.parse(value));
    }
    function alice(state: 'connected' | 'retrying' | 'connecting') {
      establish('alice');
      TestBed.tick();
      service.connect();
      if (state === 'connecting') return;
      sockets[0].open();
      sockets[0].packet('AUTHENTICATED', { userId: 'alice' });
      service.joinGame('alice-game');
      if (state === 'retrying') sockets[0].drop();
    }
    function expectOnlyBob(previous: 'connected' | 'retrying' | 'connecting') {
      vi.advanceTimersByTime(10000);
      expect(sockets).toHaveLength(2);
      if (previous !== 'retrying')
        expect(sockets[0].close).toHaveBeenCalledWith(1000, 'Client disconnected');
      sockets[1].open();
      expect(sent(sockets[1])).toEqual([
        { event: 'AUTHENTICATE', data: { accessToken: session.token() } },
      ]);
      expect(session.user()?.id).toBe('bob');
      sockets[1].packet('AUTHENTICATED', { userId: 'bob' });
      expect(service.state()).toBe('connected');
      expect(sent(sockets[1]).map((packet) => packet.event)).toEqual(['AUTHENTICATE']);
    }

    it.each(['connected', 'retrying', 'connecting'] as const)(
      'closes the %s Alice connection when Bob connects before the session effect runs',
      (previous) => {
        alice(previous);
        establish('bob');
        service.connect();
        TestBed.tick();
        expectOnlyBob(previous);
      },
    );
    it('replaces the connection when the session is cleared and established in one turn', () => {
      alice('connected');
      session.clear();
      establish('bob');
      TestBed.tick();
      expectOnlyBob('connected');
    });
    it('keeps the connection when connect() is repeated for the same session', () => {
      login();
      ready();
      service.connect();
      TestBed.tick();
      expect(sockets).toHaveLength(1);
      expect(sockets[0].close).not.toHaveBeenCalled();
      expect(service.state()).toBe('connected');
    });
  });
  it('does not create browser sockets during SSR', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        {
          provide: SOCKET_FACTORY,
          useValue: () => {
            throw new Error('Browser socket on server');
          },
        },
      ],
    });
    session = TestBed.inject(AuthSession);
    service = TestBed.inject(RealtimeService);
    login();
    expect(service.state()).toBe('disconnected');
  });
});
