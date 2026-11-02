import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import { GameHistoryItem, GamesApi } from '../game/games-api';
import { HistoryPage } from './history-page';

function item(id: string, overrides: Partial<GameHistoryItem> = {}): GameHistoryItem {
  return {
    id,
    color: 'WHITE',
    opponent: { id: 'rival', username: 'rival', avatarUrl: null, elo: 1216, color: 'BLACK' },
    outcome: 'WIN',
    reason: 'CHECKMATE',
    timeControl: { initialTime: 600_000, increment: 0 },
    moveCount: 7,
    startedAt: '2026-10-27T10:00:00.000Z',
    endedAt: '2026-10-27T10:05:00.000Z',
    ...overrides,
  };
}

describe('Game history page', () => {
  let history: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    history = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'history', component: HistoryPage }]),
        { provide: GamesApi, useValue: { history } },
      ],
    });
    TestBed.inject(AuthSession).establish({
      user: { id: 'me', username: 'me', elo: 1200 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
  });
  afterEach(() => TestBed.inject(AuthSession).clear());

  async function open(url = '/history') {
    const harness = await RouterTestingHarness.create(url);
    harness.detectChanges();
    return { harness, element: harness.routeNativeElement as HTMLElement };
  }

  it('lists result, opponent, details and date, and links each game to its replay', async () => {
    history.mockReturnValue(
      of({
        items: [
          item('g2', {
            outcome: 'DRAW',
            reason: 'DRAW_AGREEMENT',
            color: 'BLACK',
            moveCount: 0,
            opponent: {
              id: 'seat',
              username: 'Bot EASY',
              avatarUrl: null,
              elo: null,
              color: 'WHITE',
              botDifficulty: 'EASY',
            },
          }),
          item('g1', {
            outcome: 'LOSS',
            reason: 'TIMEOUT',
            timeControl: { initialTime: 420_000, increment: 3000 },
          }),
          item('g0'),
        ],
        total: 3,
        limit: 10,
        offset: 0,
      }),
    );
    const { element } = await open();
    expect(history).toHaveBeenCalledWith('me', 10, 0);
    const rows = [...element.querySelectorAll('.game')] as HTMLAnchorElement[];
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/replay/g2',
      '/replay/g1',
      '/replay/g0',
    ]);
    expect(rows.map((row) => row.querySelector('.outcome')?.textContent?.trim())).toEqual([
      'Draw',
      'Lost',
      'Won',
    ]);
    expect(rows[0].textContent).toContain('vs Computer · Easy');
    expect(rows[0].textContent).toContain('Black · by agreement · 10 + 0 · 0 moves');
    expect(rows[1].textContent).toContain('White · on time · 7 + 3 · 4 moves');
    expect(rows[2].textContent).toContain('vs rival (1216)');
    expect(rows[2].querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-10-27T10:05:00.000Z',
    );
    expect(element.querySelector('.pager')).toBeNull();
  });

  it('pages through the history with the page in the address', async () => {
    history.mockImplementation((_user: string, limit: number, offset: number) =>
      of({ items: [item(`g${offset}`)], total: 25, limit, offset }),
    );
    const { harness, element } = await open('/history?page=2');
    expect(history).toHaveBeenLastCalledWith('me', 10, 10);
    expect(element.querySelector('.pager [aria-current]')?.textContent).toBe('Page 2 of 3');
    const [previous, next] = element.querySelectorAll(
      '.pager button',
    ) as NodeListOf<HTMLButtonElement>;
    next.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/history?page=3');
    expect(history).toHaveBeenLastCalledWith('me', 10, 20);
    expect((element.querySelectorAll('.pager button')[1] as HTMLButtonElement).disabled).toBe(true);
    previous.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/history?page=2');
  });

  it('sends a page past the end to the last page and ignores invalid page numbers', async () => {
    history.mockImplementation((_user: string, limit: number, offset: number) =>
      of({ items: offset >= 20 ? [] : [item('g')], total: 12, limit, offset }),
    );
    const { harness } = await open('/history?page=9');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/history?page=2');
    await harness.navigateByUrl('/history?page=-3');
    expect(history).toHaveBeenLastCalledWith('me', 10, 0);
  });

  it('explains an empty history', async () => {
    history.mockReturnValueOnce(of({ items: [], total: 0, limit: 10, offset: 0 }));
    const empty = await open();
    expect(empty.element.textContent).toContain('No finished games yet');
    expect(empty.element.querySelector('a[href="/play"]')).not.toBeNull();
  });

  it('offers a retry after a failed load', async () => {
    history.mockReturnValueOnce(throwError(() => new Error('down')));
    history.mockReturnValueOnce(of({ items: [item('g')], total: 1, limit: 10, offset: 0 }));
    const failed = await open('/history?page=1');
    expect(failed.element.querySelector('[role="alert"]')?.textContent).toContain(
      'could not be loaded',
    );
    (failed.element.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    failed.harness.detectChanges();
    expect(failed.element.querySelectorAll('.game')).toHaveLength(1);
  });
});
