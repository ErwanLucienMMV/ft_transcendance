import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import { LeaderboardPage, pageOf } from './leaderboard-page';
import { LeaderboardRow, ProgressionApi } from './progression-api';

function row(rank: number, id: string, elo: number): LeaderboardRow {
  return {
    rank,
    id,
    username: id,
    avatarUrl: null,
    elo,
    gamesPlayed: 10,
    gamesWon: 6,
    gamesDraw: 1,
    gamesLost: 3,
    level: 4,
  };
}

describe('Leaderboard page', () => {
  let leaderboard: ReturnType<typeof vi.fn>;
  let stats: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    leaderboard = vi.fn(() =>
      of({ total: 60, items: [row(1, 'ann', 1600), row(2, 'me', 1500), row(2, 'bo', 1500)] }),
    );
    stats = vi.fn(() => of({ rank: 2 }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'leaderboard', component: LeaderboardPage }]),
        { provide: ProgressionApi, useValue: { leaderboard, stats } },
      ],
    });
  });
  afterEach(() => TestBed.inject(AuthSession).clear());

  function signIn(id: string) {
    TestBed.inject(AuthSession).establish({
      user: { id, username: id, elo: 1500 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
  }

  it('lists ranked players with shared ranks and marks the signed-in player', async () => {
    signIn('me');
    const harness = await RouterTestingHarness.create('/leaderboard');
    const element = harness.routeNativeElement as HTMLElement;
    expect(leaderboard).toHaveBeenCalledWith(0);
    const rows = [...element.querySelectorAll('tbody tr')].map((tr) =>
      [
        tr.querySelector('.rank')?.textContent,
        tr.querySelector('.player span')?.textContent,
        tr.querySelector('.elo')?.textContent,
        tr.querySelector('td.wide')?.textContent,
        tr.querySelector('td:last-child')?.textContent,
      ].join(' | '),
    );
    expect(rows).toEqual([
      '1 | ann | 1600 | 6 · 1 · 3 | 4',
      '2 | me | 1500 | 6 · 1 · 3 | 4',
      '2 | bo | 1500 | 6 · 1 · 3 | 4',
    ]);
    expect(element.querySelector('tr.me small')?.textContent).toBe('you');
    const mine = element.querySelector('tr.me');
    expect(mine?.getAttribute('aria-current')).toBe('true');
    expect(mine?.querySelector('a')?.getAttribute('href')).toBe('/players/me');
    expect(element.querySelector('.my-rank strong')?.textContent).toBe('#2');
    // The row is on this page: no need to jump to it.
    expect(element.querySelector('.my-rank button')).toBeNull();
    expect(element.querySelector('.pager [aria-current]')?.textContent).toBe('Page 1 of 3');
  });

  it('opens the page holding a rank and jumps to the signed-in player', async () => {
    signIn('far');
    stats.mockReturnValue(of({ rank: 51 }));
    const harness = await RouterTestingHarness.create('/leaderboard?rank=30');
    expect(leaderboard).toHaveBeenLastCalledWith(25);
    const element = harness.routeNativeElement as HTMLElement;
    (element.querySelector('.my-rank button') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/leaderboard?page=3');
    expect(leaderboard).toHaveBeenLastCalledWith(50);
  });

  it('invites players to a rated game when nobody is ranked', async () => {
    leaderboard.mockReturnValue(of({ total: 0, items: [] }));
    const harness = await RouterTestingHarness.create('/leaderboard');
    const element = harness.routeNativeElement as HTMLElement;
    expect(element.textContent).toContain('No ranked player yet.');
    expect(stats).not.toHaveBeenCalled();
  });

  it('finds the page of a rank', () => {
    expect([1, 25, 26, 51].map(pageOf)).toEqual([1, 1, 2, 3]);
  });
});
