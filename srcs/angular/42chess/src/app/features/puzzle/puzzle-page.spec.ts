import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import { ProgressionApi } from '../progression/progression-api';
import { boardMove, PuzzlePage } from './puzzle-page';
import { PuzzlesApi } from './puzzles-api';

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
  mistakes: 0,
  mistakesLeft: 3,
  failed: false,
  hintUsed: false,
  revealed: false,
  practice: false,
};

function apiError(status: number, code: string) {
  return new ApiError(
    new HttpErrorResponse({ status, error: { statusCode: status, code, message: 'Server text.' } }),
  );
}

describe('Puzzle page', () => {
  type Method =
    'daily' | 'published' | 'progress' | 'start' | 'attempt' | 'play' | 'hint' | 'solution';
  let api: Record<Method, ReturnType<typeof vi.fn>>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let stats: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    api = {
      daily: vi.fn(() => of(daily)),
      published: vi.fn(() => of({ ...daily, id: 'puzzle-0', date: '2026-10-20' })),
      progress: vi.fn(() => of({ attempt: null, rewarded: false })),
      start: vi.fn(() => of(attempt)),
      attempt: vi.fn(() => of(attempt)),
      play: vi.fn(),
      hint: vi.fn(),
      solution: vi.fn(),
    };
    stats = vi.fn(() => of({ puzzles: { streak: 2 } }));
    params = new BehaviorSubject(convertToParamMap({}));
    TestBed.configureTestingModule({
      imports: [PuzzlePage],
      providers: [
        provideRouter([]),
        { provide: PuzzlesApi, useValue: api },
        { provide: ProgressionApi, useValue: { stats } },
        { provide: ActivatedRoute, useValue: { paramMap: params } },
      ],
    });
  });
  afterEach(() => {
    TestBed.inject(AuthSession).clear();
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
    const button = (name: string) =>
      [...element.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === name,
      ) as HTMLButtonElement | undefined;
    render();
    return { fixture, element, render, move, button };
  }
  const text = (element: HTMLElement, selector: string) =>
    element.querySelector(selector)?.textContent?.trim().replace(/\s+/g, ' ');

  it('shows the daily position read-only and invites anonymous visitors to sign in', () => {
    const { element } = setup();
    expect(text(element, '#puzzle-title')).toBe('Find the best move for White.');
    expect(element.querySelector('.square:not([aria-disabled="true"])')).toBeNull();
    expect(element.querySelector('a[href^="/login"]')?.getAttribute('href')).toBe(
      '/login?returnUrl=%2Fpuzzle',
    );
    expect(element.textContent).toContain('Fork');
    expect(element.textContent).toContain('1200');
    expect(api.progress).not.toHaveBeenCalled();
    expect(element.querySelector('a[href="/puzzle/archive"]')).toBeNull();
  });

  it('opens an earlier day’s puzzle from its address', () => {
    params.next(convertToParamMap({ id: 'puzzle-0' }));
    const { element } = setup();
    expect(api.published).toHaveBeenCalledWith('puzzle-0');
    expect(api.daily).not.toHaveBeenCalled();
    expect(text(element, '.eyebrow')).toBe('Puzzle archive');
    expect(element.textContent).toContain('2026-10-20');
    expect(element.querySelector('a[href="/puzzle"]')?.textContent).toContain("Today's puzzle");
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
    expect(api.progress).toHaveBeenCalledWith('puzzle-1');
    expect(text(element, '.details div:nth-child(3) dd')).toBe('2 days');
    move('f3', 'h5');
    expect(api.start).toHaveBeenCalledWith('puzzle-1');
    expect(api.play).toHaveBeenCalledWith('attempt-1', 'f3h5', 0);
    expect(text(element, '#puzzle-title')).toBe('Correct! Keep going.');
    expect(element.querySelector('[data-square="f6"]')?.classList).toContain('last-move');
  });

  it('counts the tries left after a wrong move and sends the new version next time', () => {
    signIn();
    api.play.mockReturnValueOnce(
      of({
        ...attempt,
        version: 1,
        attempts: 1,
        mistakes: 1,
        mistakesLeft: 2,
        correct: false,
        completed: false,
      }),
    );
    const { element, move } = setup();
    move('f3', 'f4');
    expect(text(element, '#puzzle-title')).toBe('Not the best move. Try again.');
    expect(text(element, '.feedback')).toBe('The position is unchanged. 2 tries left.');
    expect(element.querySelector('[data-square="f4"] svg')).toBeNull();
    api.play.mockReturnValueOnce(
      of({
        ...attempt,
        version: 2,
        attempts: 2,
        mistakes: 3,
        mistakesLeft: 0,
        failed: true,
        correct: false,
        completed: false,
      }),
    );
    move('f3', 'f4');
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.play).toHaveBeenLastCalledWith('attempt-1', 'f3f4', 1);
    expect(text(element, '#puzzle-title')).toBe('Out of tries.');
    expect(element.querySelector('.square:not([aria-disabled="true"])')).toBeNull();
  });

  it('shows the reward, the time and the wrong tries once solved, then practises', () => {
    signIn();
    api.play.mockReturnValue(
      of({
        ...attempt,
        fen: AFTER,
        ply: 1,
        version: 3,
        attempts: 3,
        mistakes: 2,
        mistakesLeft: 1,
        duration: 42_000,
        correct: true,
        completed: true,
        reward: { xp: 35, streak: 3 },
      }),
    );
    const { element, move, render, button } = setup();
    move('f3', 'h5');
    expect(text(element, '#puzzle-title')).toBe('Puzzle solved!');
    expect(text(element, '[data-result="time"]')).toBe('0:42');
    expect(text(element, '[data-result="mistakes"]')).toBe('2');
    expect(text(element, '.reward')).toBe('+35 XP · 3-day streak');
    expect(text(element, '.details div:nth-child(3) dd')).toBe('3 days');
    expect(element.querySelector('.square:not([aria-disabled="true"])')).toBeNull();
    api.start.mockReturnValue(of({ ...attempt, attemptId: 'attempt-2', practice: true }));
    button('Solve it again')!.click();
    render();
    expect(api.start).toHaveBeenCalledTimes(2);
    expect(text(element, '#puzzle-title')).toBe('Find the best move for White.');
    expect(text(element, '.note')).toContain('Practice attempt: it earns no XP.');
  });

  it('points out the piece to move after a hint', () => {
    signIn();
    api.hint.mockReturnValue(of({ ...attempt, hintUsed: true, hint: 'f3' }));
    const { element, render, button } = setup();
    expect(text(element, '.note')).toContain('A hint halves the XP');
    button('Hint')!.click();
    render();
    expect(api.start).toHaveBeenCalledWith('puzzle-1');
    expect(api.hint).toHaveBeenCalledWith('attempt-1');
    expect(text(element, '.hint-note')).toBe('Hint: move the piece on f3.');
    expect(element.querySelector('[data-square="f3"]')?.classList).toContain('hint');
    expect(button('Hint')!.disabled).toBe(true);
  });

  it('replays the shown solution move by move and ends the attempt', () => {
    signIn();
    api.progress.mockReturnValue(of({ attempt, rewarded: false }));
    api.solution.mockReturnValue(
      of({ ...attempt, revealed: true, failed: true, solution: ['f3h5', 'g8f6'] }),
    );
    const { element, fixture, render, button } = setup();
    button('Show the solution')!.click();
    render();
    expect(api.start).not.toHaveBeenCalled();
    expect(api.solution).toHaveBeenCalledWith('attempt-1');
    expect(text(element, '#puzzle-title')).toBe('Solution shown.');
    expect(text(element, '.replay span')).toBe('Move 2 of 2');
    (element.querySelector('[aria-label="Previous move"]') as HTMLButtonElement).click();
    render();
    expect(fixture.componentInstance.fen()).toBe(AFTER);
    expect(element.querySelector('[data-square="h5"]')?.classList).toContain('last-move');
    expect(button('Try again')).toBeDefined();
    expect(button('Show the solution')).toBeUndefined();
  });

  it('resumes the latest attempt from the server for the signed-in account only', () => {
    api.progress.mockReturnValue(
      of({ attempt: { ...attempt, fen: AFTER, ply: 2, version: 1 }, rewarded: true }),
    );
    const { fixture } = setup();
    expect(api.progress).not.toHaveBeenCalled();
    signIn('me');
    TestBed.tick();
    expect(api.progress).toHaveBeenCalledWith('puzzle-1');
    expect(fixture.componentInstance.fen()).toBe(AFTER);
    expect(fixture.componentInstance.scored()).toBe(false);
    TestBed.inject(AuthSession).clear();
    TestBed.tick();
    expect(fixture.componentInstance.attempt()).toBeNull();
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

  it('reads UCI moves, promotions included', () => {
    expect(boardMove('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'QUEEN' });
    expect(boardMove('g1f3')).toEqual({ from: 'g1', to: 'f3', promotion: null });
  });
});
