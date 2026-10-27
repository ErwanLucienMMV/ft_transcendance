import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import { PuzzlePage } from './puzzle-page';
import { PuzzleProgress, PuzzlesApi } from './puzzles-api';

// A White-to-move position; the server answers are simulated.
const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 2 3';
const AFTER = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
const daily = { id: 'puzzle-1', date: '2026-10-27', rating: 1200, fen: FEN, themes: ['FORK'] };
const attempt = {
  attemptId: 'attempt-1',
  puzzleId: 'puzzle-1',
  fen: FEN,
  ply: 0,
  version: 0,
  completed: false,
  attempts: 0,
  duration: 0,
};

function apiError(status: number, code: string) {
  return new ApiError(
    new HttpErrorResponse({ status, error: { statusCode: status, code, message: 'Server text.' } }),
  );
}

describe('Daily puzzle page', () => {
  let api: Record<'daily' | 'start' | 'attempt' | 'play', ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    api = {
      daily: vi.fn(() => of(daily)),
      start: vi.fn(() => of(attempt)),
      attempt: vi.fn(() => of(attempt)),
      play: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [PuzzlePage],
      providers: [provideRouter([]), { provide: PuzzlesApi, useValue: api }],
    });
  });
  afterEach(() => {
    TestBed.inject(AuthSession).clear();
    sessionStorage.clear();
  });

  function signIn(id = 'me') {
    TestBed.inject(AuthSession).establish({
      user: { id, username: id, elo: 1000 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
  }
  function setup() {
    const fixture = TestBed.createComponent(PuzzlePage);
    const element = fixture.nativeElement as HTMLElement;
    const render = () => {
      TestBed.tick();
      fixture.detectChanges();
    };
    const move = (from: string, to: string) => {
      (element.querySelector(`[data-square="${from}"]`) as HTMLElement).click();
      render();
      (element.querySelector(`[data-square="${to}"]`) as HTMLElement).click();
      render();
    };
    render();
    return { fixture, element, render, move };
  }
  const text = (element: HTMLElement, selector: string) =>
    element.querySelector(selector)?.textContent?.trim();

  it('shows the daily position read-only and invites anonymous visitors to sign in', () => {
    const { element } = setup();
    expect(text(element, '#puzzle-title')).toBe('Find the best move for White.');
    expect(element.querySelector('.square:not([disabled])')).toBeNull();
    expect(element.querySelector('a[href^="/login"]')?.getAttribute('href')).toBe(
      '/login?returnUrl=%2Fpuzzle',
    );
    expect(element.textContent).toContain('Fork');
    expect(element.textContent).toContain('1200');
  });

  it('starts an attempt on the first move, sends UCI and shows the opponent reply', () => {
    signIn();
    api.play.mockReturnValue(
      of({
        ...attempt,
        fen: AFTER,
        ply: 2,
        version: 1,
        attempts: 1,
        correct: true,
        completed: false,
        nextPosition: AFTER,
        opponentMove: 'g8f6',
      }),
    );
    const { element, move } = setup();
    move('f3', 'h5');
    expect(api.start).toHaveBeenCalledWith('puzzle-1');
    expect(api.play).toHaveBeenCalledWith('attempt-1', 'f3h5', 0);
    expect(text(element, '#puzzle-title')).toBe('Correct! Keep going.');
    expect(element.querySelector('[data-square="f6"]')?.classList).toContain('last-move');
    expect(TestBed.inject(PuzzleProgress).find('me', 'puzzle-1')).toBe('attempt-1');
  });

  it('keeps the position after a wrong move and sends the new version next time', () => {
    signIn();
    api.play.mockReturnValueOnce(
      of({ ...attempt, version: 1, attempts: 1, correct: false, completed: false }),
    );
    const { element, move } = setup();
    move('f3', 'f4');
    expect(text(element, '#puzzle-title')).toBe('Not the best move. Try again.');
    expect(element.querySelector('[data-square="f4"] svg')).toBeNull();
    expect(element.querySelector('[data-square="f3"] svg')).not.toBeNull();
    api.play.mockReturnValueOnce(
      of({ ...attempt, version: 2, attempts: 2, correct: false, completed: false }),
    );
    move('f3', 'f4');
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.play).toHaveBeenLastCalledWith('attempt-1', 'f3f4', 1);
  });

  it('shows the time and the wrong tries once solved, and can start again', () => {
    signIn();
    api.play.mockReturnValue(
      of({
        ...attempt,
        fen: AFTER,
        ply: 1,
        version: 3,
        attempts: 3,
        duration: 42_000,
        correct: true,
        completed: true,
      }),
    );
    const { element, move, render } = setup();
    move('f3', 'h5');
    expect(text(element, '#puzzle-title')).toBe('Puzzle solved!');
    expect(text(element, '[data-result="time"]')).toBe('0:42');
    expect(text(element, '[data-result="mistakes"]')).toBe('2');
    expect(element.querySelector('.square:not([disabled])')).toBeNull();
    (element.querySelector('.result + button') as HTMLButtonElement).click();
    render();
    expect(text(element, '#puzzle-title')).toBe('Find the best move for White.');
    expect(TestBed.inject(PuzzleProgress).find('me', 'puzzle-1')).toBeNull();
  });

  it('resumes the attempt of this tab for the same account only', () => {
    TestBed.inject(PuzzleProgress).remember('me', 'puzzle-1', 'attempt-1');
    api.attempt.mockReturnValue(of({ ...attempt, fen: AFTER, ply: 2, version: 1 }));
    signIn('someone-else');
    setup();
    expect(api.attempt).not.toHaveBeenCalled();
    signIn('me');
    const { fixture } = setup();
    expect(api.attempt).toHaveBeenCalledWith('attempt-1');
    expect(fixture.componentInstance.fen()).toBe(AFTER);
    TestBed.inject(AuthSession).clear();
    TestBed.tick();
    expect(fixture.componentInstance.attempt()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('reloads the server state after a stale version', () => {
    signIn();
    api.play.mockReturnValue(throwError(() => apiError(409, 'PUZZLE_STALE_VERSION')));
    api.attempt.mockReturnValue(of({ ...attempt, fen: AFTER, ply: 2, version: 4 }));
    const { element, move, fixture } = setup();
    move('f3', 'h5');
    expect(api.attempt).toHaveBeenCalledWith('attempt-1');
    expect(fixture.componentInstance.attempt()?.version).toBe(4);
    expect(text(element, '[role="alert"]')).toBe('Your progress was updated from another tab.');
  });

  it('explains an empty catalogue and an engine outage', () => {
    api.daily.mockReturnValue(throwError(() => apiError(503, 'PUZZLE_CATALOG_EMPTY')));
    const { element } = setup();
    expect(text(element, '[role="alert"]')).toBe('No puzzle is available today.');
    expect(element.querySelector('app-chess-board')).toBeNull();
    api.daily.mockReturnValue(of(daily));
    signIn();
    api.play.mockReturnValue(throwError(() => apiError(503, 'PUZZLE_ENGINE_UNAVAILABLE')));
    const second = setup();
    second.move('f3', 'h5');
    expect(text(second.element, '[role="alert"]')).toContain('The puzzle checker is unavailable.');
    expect(second.element.querySelector('[data-square="h5"] svg')).toBeNull();
  });
});
