import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
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
    spectateGame: ReturnType<typeof vi.fn>;
    stopSpectating: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
  let query: Record<string, string>;
  let api: { get: ReturnType<typeof vi.fn>; resumeBot: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    events = new Subject();
    transport = {
      state: signal('connected'),
      events: events.asObservable(),
      connect: vi.fn(),
      joinGame: vi.fn(() => true),
      leaveGame: vi.fn(() => true),
      spectateGame: vi.fn(() => true),
      stopSpectating: vi.fn(() => true),
      send: vi.fn(() => true),
    };
    query = {};
    api = { get: vi.fn(), resumeBot: vi.fn() };
    TestBed.configureTestingModule({
      imports: [GamePage],
      providers: [
        provideRouter([]),
        { provide: RealtimeService, useValue: transport },
        { provide: GamesApi, useValue: api },
        {
          provide: ActivatedRoute,
          useFactory: () => ({
            paramMap: of(convertToParamMap({ id })),
            queryParamMap: of(convertToParamMap(query)),
          }),
        },
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

  it('shows the server-projected clock once a sync round trip has measured the delay', () => {
    let now = 1_000;
    const timer = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const { element, state, render } = setup();
      const sample = { serverTime: new Date().toISOString(), clockStatus: 'RUNNING' };
      state(sample);
      expect(transport.send).toHaveBeenCalledWith('SYNC_CLOCK', { gameId: id, requestId: 1 });
      // The answer took 400 ms, 100 ms of it on the server: the clock was read 150 ms ago.
      now = 1_400;
      events.next({
        event: 'CLOCK_SYNC',
        data: {
          gameId: id,
          requestId: 1,
          clocks: { white: 300_000, black: 300_000 },
          turn: 'WHITE',
          processingMs: 100,
          sampleAgeMs: 0,
          ...sample,
        },
      });
      now = 3_400;
      vi.advanceTimersByTime(100);
      render();
      expect(text(element, '[data-seat="bottom"] [role="timer"]')).toBe('4:57');
      expect(text(element, '[data-seat="top"] [role="timer"]')).toBe('5:00');
    } finally {
      timer.mockRestore();
    }
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
    expect(text(element, '.overlay.result')).toBe('Black wins on time');
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

  describe('as a spectator', () => {
    const third = { ...black, id: 'third', username: 'Third', color: 'BLACK' };

    it('watches instead when the server says this user has no seat', () => {
      const { element, render, state } = setup();
      events.next({ event: 'ERROR', data: { code: 'NOT_A_PLAYER' } });
      render();
      expect(transport.spectateGame).toHaveBeenCalledWith(id);
      expect(element.querySelector('[role="alert"]')).toBeNull();
      state({ whitePlayer: black, blackPlayer: third, spectatorCount: 1 });
      expect(text(element, '.eyebrow')).toBe('Spectating');
      expect(text(element, '#game-title')).toBe('White to move');
      expect(text(element, '[data-watchers]')).toBe('1 spectator watching');
      expect(element.querySelector('.square:not([disabled])')).toBeNull();
    });

    it('opens straight as a spectator from the live list and hides every player action', () => {
      query = { watch: '1' };
      const { element, state, button } = setup();
      expect(transport.spectateGame).toHaveBeenCalledWith(id);
      expect(transport.joinGame).not.toHaveBeenCalled();
      // Even the seated user, if they chose to watch, gets no player controls.
      state({ spectatorCount: 3 });
      expect(text(element, '#game-title')).toBe('White to move');
      expect(text(element, '[data-watchers]')).toBe('3 spectators watching');
      for (const label of ['Resign', 'Offer draw']) expect(button(label)).toBeUndefined();
      expect(element.querySelector('.square:not([disabled])')).toBeNull();
      expect(text(element, '[data-seat="bottom"] .player')).toBe('Ta2b (you)');
    });

    it('follows the moves and the end of the game, then leaves for the live list', () => {
      query = { watch: '1' };
      const { element, render, state, button } = setup();
      state({ whitePlayer: black, blackPlayer: third });
      events.next({
        event: 'MOVE_PLAYED',
        data: {
          gameId: id,
          move: { number: 1, playerId: 'rival', from: 'e2', to: 'e4', notation: 'e4', fen: '' },
          board: {
            fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
            turn: 'BLACK',
            halfmoveClock: 0,
            fullmoveNumber: 1,
          },
        },
      });
      render();
      expect(text(element, '.move-list li')).toContain('e4');
      expect(text(element, '#game-title')).toBe('Black to move');
      events.next({
        event: 'GAME_ENDED',
        data: { gameId: id, result: { winner: 'WHITE', reason: 'RESIGNATION' } },
      });
      render();
      expect(text(element, '#game-title')).toBe('White wins by resignation');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      button('Stop watching')!.click();
      render();
      expect(transport.stopSpectating).toHaveBeenCalledWith(id);
      expect(navigate).toHaveBeenCalledWith(['/live']);
    });

    it('shows how many people watch to the players too', () => {
      const { element, state } = setup();
      state();
      expect(element.querySelector('[data-watchers]')).toBeNull();
      state({ spectatorCount: 2 });
      expect(text(element, '[data-watchers]')).toBe('2 spectators watching');
      expect(text(element, '.eyebrow')).toBe('Live game');
    });
  });

  it('leaves the game room when the page closes', () => {
    const { fixture } = setup();
    fixture.destroy();
    expect(transport.leaveGame).toHaveBeenCalledWith(id);
  });

  describe('against the bot', () => {
    const bot = {
      id: 'seat',
      username: 'Bot MEDIUM',
      avatarUrl: null,
      elo: null,
      color: 'BLACK',
      botDifficulty: 'MEDIUM',
    };

    it('names the bot, hides draw offers and shows it thinking after my move', () => {
      const { element, click, state, button } = setup();
      state({ blackPlayer: bot });
      expect(text(element, '[data-seat="top"] .player')).toBe('Computer · Medium');
      expect(button('Offer draw')).toBeUndefined();
      expect(element.querySelector('.thinking')).toBeNull();
      click('[data-square="g1"]');
      click('[data-square="f3"]');
      expect(text(element, '#game-title')).toBe('The bot is thinking…');
      expect(element.querySelector('.thinking')).not.toBeNull();
      events.next({
        event: 'MOVE_PLAYED',
        data: {
          gameId: id,
          move: { number: 1, playerId: 'me', from: 'g1', to: 'f3', notation: 'Nf3', fen: '' },
          board: {
            fen: 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1',
            turn: 'BLACK',
            halfmoveClock: 1,
            fullmoveNumber: 1,
          },
          clocks: { white: 300_000, black: 300_000 },
        },
      });
      events.next({
        event: 'MOVE_PLAYED',
        data: {
          gameId: id,
          move: { number: 2, playerId: 'seat', from: 'd7', to: 'd5', notation: 'd5', fen: '' },
          board: {
            fen: 'rnbqkbnr/ppp1pppp/8/3p4/8/5N2/PPPPPPPP/RNBQKB1R w KQkq d6 0 2',
            turn: 'WHITE',
            halfmoveClock: 0,
            fullmoveNumber: 2,
          },
          clocks: { white: 300_000, black: 299_000 },
        },
      });
      state({
        blackPlayer: bot,
        board: {
          fen: 'rnbqkbnr/ppp1pppp/8/3p4/8/5N2/PPPPPPPP/RNBQKB1R w KQkq d6 0 2',
          turn: 'WHITE',
          halfmoveClock: 0,
          fullmoveNumber: 2,
        },
        moves: [
          { number: 1, playerId: 'me', from: 'g1', to: 'f3', notation: 'Nf3', fen: '' },
          { number: 2, playerId: 'seat', from: 'd7', to: 'd5', notation: 'd5', fen: '' },
        ],
      });
      expect(text(element, '#game-title')).toBe('Your turn');
      expect(element.querySelector('.thinking')).toBeNull();
      expect(element.querySelector('[data-square="d5"]')?.classList).toContain('last-move');
      expect(text(element, '.move-list li')).toBe('Nf3d5');
    });

    it('shows the bot thinking first when I play black', () => {
      const { element, state } = setup();
      state({
        whitePlayer: { ...bot, color: 'WHITE' },
        blackPlayer: { ...white, color: 'BLACK' },
        botPending: true,
        botThinking: true,
      });
      expect(text(element, '#game-title')).toBe('The bot is thinking…');
      expect(element.querySelector('.square')?.getAttribute('data-square')).toBe('h1');
    });

    it('lets me ask the bot again after it failed', () => {
      api.resumeBot.mockReturnValueOnce(throwError(() => new Error('offline')));
      const { element, state, button, render } = setup();
      state({
        blackPlayer: bot,
        board: {
          fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
          turn: 'BLACK',
          halfmoveClock: 0,
          fullmoveNumber: 1,
        },
        botPending: true,
        botError: 'BOT_UNAVAILABLE',
      });
      expect(text(element, '#game-title')).toBe('The bot could not play');
      expect(element.querySelector('.thinking')).toBeNull();
      button('Ask the bot to play')!.click();
      render();
      expect(api.resumeBot).toHaveBeenCalledWith(id);
      expect(element.textContent).toContain('The bot is still unavailable.');
      api.resumeBot.mockReturnValueOnce(of({}));
      button('Ask the bot to play')!.click();
      render();
      expect(element.textContent).not.toContain('The bot is still unavailable.');
      state({ blackPlayer: bot, botError: null });
      expect(element.querySelector('.bot-failed')).toBeNull();
    });
  });
});
