import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AuthSession } from '../auth/auth-session';
import { GameRealtime } from './game-realtime';
import { RealtimeService, ServerEvent } from './realtime.service';

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
