import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import { RealtimeService, ServerEvent } from '../../core/realtime/realtime.service';
import { GamePage } from './game-page';
import { GamesApi } from './games-api';

const id = '00000000-0000-4000-8000-000000000001';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const white = { id: 'me', username: 'Ta2b', avatarUrl: null, elo: 1000, color: 'WHITE' };
const black = { id: 'rival', username: 'Rival', avatarUrl: null, elo: 1000, color: 'BLACK' };

describe('Live game page', () => {
  let events: Subject<ServerEvent>;
  let transport: {
    state: ReturnType<typeof signal<string>>;
    events: unknown;
    connect: ReturnType<typeof vi.fn>;
    joinGame: ReturnType<typeof vi.fn>;
    leaveGame: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
  let api: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    events = new Subject();
    transport = {
      state: signal('connected'),
      events: events.asObservable(),
      connect: vi.fn(),
      joinGame: vi.fn(() => true),
      leaveGame: vi.fn(() => true),
      send: vi.fn(() => true),
    };
    api = { get: vi.fn() };
    TestBed.configureTestingModule({
      imports: [GamePage],
      providers: [
        provideRouter([]),
        { provide: RealtimeService, useValue: transport },
        { provide: GamesApi, useValue: api },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id })) } },
      ],
    });
    TestBed.inject(AuthSession).establish({
      user: { id: 'me', username: 'Ta2b', elo: 1000 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
  });
  afterEach(() => {
    TestBed.inject(AuthSession).clear();
    events.complete();
    vi.useRealTimers();
  });

  function setup() {
    const fixture = TestBed.createComponent(GamePage);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const render = () => {
      TestBed.tick();
      fixture.detectChanges();
    };
    const click = (selector: string) => {
      (element.querySelector(selector) as HTMLElement).click();
      render();
    };
    const button = (text: string) =>
      [...element.querySelectorAll('button')].find((item) => item.textContent?.trim() === text);
    const state = (overrides: Record<string, unknown> = {}) => {
      events.next({
        event: 'GAME_STATE',
        data: {
          id,
          gameId: id,
          status: 'ACTIVE',
          whitePlayer: white,
          blackPlayer: black,
          timeControl: { initialTime: 300_000, increment: 0 },
          board: { fen: START, turn: 'WHITE', halfmoveClock: 0, fullmoveNumber: 1 },
          clocks: { white: 300_000, black: 300_000 },
          result: null,
          drawOffer: null,
          moves: [],
          ...overrides,
        },
      });
      render();
    };
    render();
    return { fixture, element, render, click, button, state };
  }
  const text = (element: HTMLElement, selector: string) =>
    element.querySelector(selector)?.textContent?.trim();

  it('joins the game from the URL and shows both players with their clocks', () => {
    const { element, state } = setup();
    expect(transport.joinGame).toHaveBeenCalledWith(id);
    expect(text(element, '[role="status"]')).toBe('Loading the game…');
    state();
    expect(text(element, '#game-title')).toBe('Your turn');
    expect(text(element, '[data-seat="bottom"] .player')).toBe('Ta2b (you)');
    expect(text(element, '[data-seat="top"] .player')).toBe('Rival');
    expect(text(element, '[data-seat="bottom"] [role="timer"]')).toBe('5:00');
    expect(element.querySelector('.square')?.getAttribute('data-square')).toBe('a8');
  });

  it('counts down the running clock between server updates', () => {
    const { element, state, render } = setup();
    state();
    vi.advanceTimersByTime(3_000);
    render();
    expect(text(element, '[data-seat="bottom"] [role="timer"]')).toBe('4:57');
    expect(text(element, '[data-seat="top"] [role="timer"]')).toBe('5:00');
    events.next({
      event: 'CLOCK_UPDATE',
      data: { gameId: id, clocks: { white: 299_500, black: 300_000 } },
    });
    render();
    expect(text(element, '[data-seat="bottom"] [role="timer"]')).toBe('4:59');
  });

  it('sends a move, previews it, and drops the preview when the server rejects it', () => {
    const { element, click, state, fixture } = setup();
    state();
    click('[data-square="e2"]');
    click('[data-square="e4"]');
    expect(transport.send).toHaveBeenCalledWith('MAKE_MOVE', {
      gameId: id,
      from: 'e2',
      to: 'e4',
      promotion: null,
    });
    expect(element.querySelector('[data-square="e4"] svg')).not.toBeNull();
    expect(text(element, '#game-title')).toBe('Sending your move…');
    expect(fixture.componentInstance.canPlay()).toBe(false);
    events.next({ event: 'ERROR', data: { code: 'ILLEGAL_MOVE', message: 'no' } });
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
    expect(element.querySelector('[data-square="e4"] svg')).toBeNull();
    expect(text(element, '.game-error')).toBe('That move is not legal in this position.');
  });

  it('follows the opponent moves and lists them in pairs', () => {
    const { element, state } = setup();
    state({
      board: {
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        turn: 'WHITE',
        halfmoveClock: 0,
        fullmoveNumber: 2,
      },
      moves: [
        { number: 1, playerId: 'me', from: 'e2', to: 'e4', notation: 'e4', fen: '', timestamp: '' },
        {
          number: 2,
          playerId: 'rival',
          from: 'e7',
          to: 'e5',
          notation: 'e5',
          fen: '',
          timestamp: '',
        },
      ],
    });
    expect(text(element, '.move-list li')).toBe('e4e5');
    expect(element.querySelector('[data-square="e5"]')?.classList).toContain('last-move');
  });

  it('asks for confirmation before resigning', () => {
    const { button, render, state } = setup();
    state();
    button('Resign')!.click();
    render();
    expect(transport.send).not.toHaveBeenCalled();
    button('Keep playing')!.click();
    render();
    button('Resign')!.click();
    render();
    button('Confirm resignation')!.click();
    render();
    expect(transport.send).toHaveBeenCalledWith('RESIGN', { gameId: id });
  });

  it('offers, answers and reports draws', () => {
    const { element, button, render, state } = setup();
    state();
    button('Offer draw')!.click();
    render();
    expect(transport.send).toHaveBeenCalledWith('OFFER_DRAW', { gameId: id });
    state({ drawOffer: { playerId: 'me' } });
    expect(button('Offer draw')).toBeUndefined();
    expect(element.textContent).toContain("Waiting for your opponent's answer");
    state({ drawOffer: { playerId: 'rival' } });
    button('Decline')!.click();
    render();
    expect(transport.send).toHaveBeenCalledWith('DECLINE_DRAW', { gameId: id });
    state({ drawOffer: { playerId: 'rival' } });
    button('Accept draw')!.click();
    render();
    expect(transport.send).toHaveBeenCalledWith('ACCEPT_DRAW', { gameId: id });
    state({ drawOffer: null });
    events.next({ event: 'DRAW_DECLINED', data: { gameId: id, playerId: 'rival' } });
    render();
    expect(element.textContent).toContain('Your draw offer was declined.');
  });

  it('shows the final result from my side and stops the clocks', () => {
    const { element, state } = setup();
    state({ status: 'FINISHED', result: { winner: 'BLACK', reason: 'TIMEOUT' } });
    expect(text(element, '#game-title')).toBe('You lost on time');
    expect(element.querySelector('.running')).toBeNull();
    expect(element.querySelector('a[href="/play"]')).not.toBeNull();
    expect(text(element, '.overlay.result')).toBe('Black wins · time out');
  });

  it('shows the invitation link while waiting for an opponent', () => {
    const { element, state } = setup();
    state({ status: 'WAITING', blackPlayer: null, clocks: null });
    expect(text(element, '#game-title')).toBe('Waiting for an opponent');
    expect((element.querySelector('.invite input') as HTMLInputElement).value).toContain(
      `/game/${id}`,
    );
    expect(text(element, '[data-seat="top"] .player')).toBe('Waiting for a player');
  });

  it('plays from the black side with the board turned around', () => {
    const { element, state } = setup();
    state({
      whitePlayer: { ...black, color: 'WHITE' },
      blackPlayer: { ...white, color: 'BLACK' },
    });
    expect(element.querySelector('.square')?.getAttribute('data-square')).toBe('h1');
    expect(text(element, '#game-title')).toBe("Opponent's turn");
  });

  it('reports a lost connection and reconnects on request', () => {
    const { element, render, button, state } = setup();
    state();
    transport.state.set('reconnecting');
    render();
    expect(text(element, '.connection')).toBe('Connection lost. Reconnecting…');
    transport.state.set('unavailable');
    render();
    button('Reconnect')!.click();
    expect(transport.connect).toHaveBeenCalledTimes(2);
    transport.state.set('connected');
    render();
    expect(element.querySelector('.connection')).toBeNull();
  });

  it('falls back to a read-only board for someone who is not seated', () => {
    api.get.mockReturnValue(
      of({
        id,
        status: 'ACTIVE',
        whitePlayer: black,
        blackPlayer: { ...black, id: 'third', username: 'Third' },
        board: { fen: START, turn: 'WHITE', halfmoveClock: 0, fullmoveNumber: 1 },
        clocks: { white: 1000, black: 1000 },
        result: null,
        drawOffer: null,
      }),
    );
    const { element, render } = setup();
    events.next({ event: 'ERROR', data: { code: 'NOT_A_PLAYER' } });
    render();
    expect(api.get).toHaveBeenCalledWith(id);
    expect(text(element, '#game-title')).toBe('White to move');
    expect(element.querySelector('.actions')).toBeNull();
    expect(element.querySelector('.square:not([disabled])')).toBeNull();
  });

  it('leaves the game room when the page closes', () => {
    const { fixture } = setup();
    fixture.destroy();
    expect(transport.leaveGame).toHaveBeenCalledWith(id);
  });
});
