import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import type { GameMove } from '../../core/realtime/game-realtime';
import { START_FEN } from '../../shared/chess/game-text';
import { GameView, GamesApi } from '../game/games-api';
import { ReplayPage } from './replay-page';

const GAME_ID = '4f2d6a8c-5b7e-4d9f-8a0b-1c2d3e4f5a6b';

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const moves: GameMove[] = [
  {
    number: 1,
    playerId: 'white',
    from: 'e2',
    to: 'e4',
    notation: 'e4',
    fen: AFTER_E4,
    timestamp: '',
  },
  {
    number: 2,
    playerId: 'black',
    from: 'e7',
    to: 'e5',
    notation: 'e5',
    fen: AFTER_E5,
    timestamp: '',
  },
];
const game: GameView = {
  id: GAME_ID,
  status: 'FINISHED',
  whitePlayer: { id: 'white', username: 'white', avatarUrl: null, elo: 1200, color: 'WHITE' },
  blackPlayer: { id: 'black', username: 'black', avatarUrl: null, elo: 1180, color: 'BLACK' },
  timeControl: { initialTime: 600_000, increment: 0 },
  board: { fen: AFTER_E5, turn: 'WHITE', halfmoveClock: 0, fullmoveNumber: 2 },
  clocks: null,
  result: { winner: 'WHITE', reason: 'RESIGNATION' },
  drawOffer: null,
  startedAt: '2026-10-27T10:00:00.000Z',
  endedAt: '2026-10-27T10:05:00.000Z',
  createdAt: '2026-10-27T10:00:00.000Z',
};

describe('Game replay page', () => {
  let api: { get: ReturnType<typeof vi.fn>; moves: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    api = { get: vi.fn(() => of(game)), moves: vi.fn(() => of({ moves })) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'replay/:id', component: ReplayPage }]),
        { provide: GamesApi, useValue: api },
      ],
    });
  });
  afterEach(() => TestBed.inject(AuthSession).clear());

  async function open(id = GAME_ID) {
    const harness = await RouterTestingHarness.create(`/replay/${id}`);
    harness.detectChanges();
    const element = harness.routeNativeElement as HTMLElement;
    const component = harness.routeDebugElement!.componentInstance as ReplayPage;
    return { harness, element, component };
  }
  const button = (element: HTMLElement, label: string) =>
    element.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;

  it('opens on the final position with the result and steps through every stored position', async () => {
    const { harness, element, component } = await open();
    expect(api.get).toHaveBeenCalledWith(GAME_ID);
    expect(api.moves).toHaveBeenCalledWith(GAME_ID);
    expect(element.querySelector('#replay-title')?.textContent).toBe('White wins by resignation');
    expect(component.fen()).toBe(AFTER_E5);
    expect(element.querySelector('.position')?.textContent).toBe('Move 2 / 2');
    expect(element.querySelector('.overlay.result')).not.toBeNull();
    expect(button(element, 'Next move').disabled).toBe(true);

    button(element, 'Previous move').click();
    harness.detectChanges();
    expect(component.fen()).toBe(AFTER_E4);
    expect(component.lastMove()).toEqual({ from: 'e2', to: 'e4' });
    expect(element.querySelector('.overlay.result')).toBeNull();
    button(element, 'First position').click();
    harness.detectChanges();
    expect(component.fen()).toBe(START_FEN);
    expect(component.lastMove()).toBeNull();
    expect(button(element, 'Previous move').disabled).toBe(true);

    (element.querySelectorAll('button.move')[1] as HTMLButtonElement).click();
    harness.detectChanges();
    expect(component.ply()).toBe(2);
    expect(element.querySelector('button.move[aria-current="step"]')?.textContent?.trim()).toBe(
      'e5',
    );
  });

  it('follows the arrow, Home and End keys and never leaves the game', async () => {
    const { harness, component } = await open();
    const host = harness.routeNativeElement as HTMLElement;
    const key = (name: string) => {
      host.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
      harness.detectChanges();
    };
    key('Home');
    expect(component.ply()).toBe(0);
    key('ArrowLeft');
    expect(component.ply()).toBe(0);
    key('ArrowRight');
    expect(component.ply()).toBe(1);
    key('End');
    key('ArrowRight');
    expect(component.ply()).toBe(2);
  });

  it('steps with the arrow keys from anywhere on the page, but not while typing', async () => {
    const { harness, component } = await open();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    harness.detectChanges();
    expect(component.ply()).toBe(1);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    input.remove();
    expect(component.ply()).toBe(1);
  });

  it('plays the game by itself, one move a second, and stops at the end', async () => {
    vi.useFakeTimers();
    try {
      const { harness, element, component } = await open();
      const play = element.querySelector('[data-autoplay]') as HTMLButtonElement;
      play.click();
      harness.detectChanges();
      TestBed.tick();
      // From the end, it starts again from the first position.
      expect(component.ply()).toBe(0);
      expect(play.getAttribute('aria-label')).toBe('Pause');
      vi.advanceTimersByTime(1000);
      expect(component.ply()).toBe(1);
      vi.advanceTimersByTime(2000);
      harness.detectChanges();
      expect(component.ply()).toBe(2);
      expect(component.playing()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the shown position on the analysis board', async () => {
    const { harness, element, component } = await open();
    component.goTo(1);
    harness.detectChanges();
    const link = [...element.querySelectorAll('a')].find((a) =>
      a.textContent?.includes('Analyse this position'),
    );
    expect(decodeURIComponent(link?.getAttribute('href') ?? '')).toBe(`/board?fen=${AFTER_E4}`);
  });

  it('shows a seated player from their side and with their own result', async () => {
    TestBed.inject(AuthSession).establish({
      user: { id: 'black', username: 'black', elo: 1180 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
    const { harness, element, component } = await open();
    expect(component.orientation()).toBe('BLACK');
    expect(element.querySelector('#replay-title')?.textContent).toBe('You lost by resignation');
    expect(element.querySelectorAll('.seat')[1].textContent?.trim()).toBe('black (1180)');
    (
      [...element.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Flip'),
      ) as HTMLButtonElement
    ).click();
    harness.detectChanges();
    expect(component.orientation()).toBe('WHITE');
  });

  it('points an unfinished game to the live page', async () => {
    api.get.mockReturnValueOnce(of({ ...game, status: 'ACTIVE', result: null }));
    const live = await open();
    expect(live.element.textContent).toContain('still in progress');
    expect(live.element.querySelector(`a[href="/game/${GAME_ID}"]`)).not.toBeNull();
  });

  it('explains a missing game', async () => {
    api.get.mockReturnValueOnce(
      throwError(
        () =>
          new ApiError(
            new HttpErrorResponse({
              status: 404,
              error: { statusCode: 404, code: 'GAME_NOT_FOUND', message: 'Game does not exist.' },
            }),
          ),
      ),
    );
    const missing = await open('5a3e7b9d-6c8f-4e0a-9b1c-2d3e4f5a6b7c');
    expect(missing.element.querySelector('[role="alert"]')?.textContent).toBe(
      'This game does not exist.',
    );
    expect(missing.element.querySelector('app-chess-board')).toBeNull();
  });

  it('answers a mistyped address without asking the server', async () => {
    const { element } = await open('nope');
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('This game does not exist.');
    expect(api.get).not.toHaveBeenCalled();
  });
});
