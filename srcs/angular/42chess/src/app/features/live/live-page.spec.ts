import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import { GamesApi, LiveGame } from '../game/games-api';
import { LIVE_REFRESH_MS, LivePage } from './live-page';

const player = (id: string, color: 'WHITE' | 'BLACK', elo: number | null = 1200) => ({
  id,
  username: id,
  avatarUrl: null,
  elo,
  color,
});
function game(id: string, overrides: Partial<LiveGame> = {}): LiveGame {
  return {
    id,
    whitePlayer: player('alice', 'WHITE', 1250),
    blackPlayer: player('bob', 'BLACK', 1190),
    spectatorCount: 0,
    timeControl: { initialTime: 180_000, increment: 2000 },
    startedAt: '2026-10-27T10:00:00.000Z',
    ...overrides,
  };
}

describe('Live games page', () => {
  let live: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    live = vi.fn();
    TestBed.configureTestingModule({
      imports: [LivePage],
      providers: [provideRouter([]), { provide: GamesApi, useValue: { live } }],
    });
  });
  afterEach(() => {
    TestBed.inject(AuthSession).clear();
    vi.useRealTimers();
  });
  function setup() {
    const fixture = TestBed.createComponent(LivePage);
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('lists the games in progress with players, time control, spectators and a watch link', () => {
    live.mockReturnValue(
      of({
        games: [
          game('g1', { spectatorCount: 1 }),
          game('g2', {
            spectatorCount: 4,
            blackPlayer: { ...player('seat', 'BLACK', null), botDifficulty: 'HARD' },
          }),
        ],
      }),
    );
    const { element } = setup();
    const rows = [...element.querySelectorAll('.game')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('alice (1250)');
    expect(rows[0].textContent).toContain('bob (1190)');
    expect(rows[0].textContent).toContain('3 + 2');
    expect(rows[0].querySelector('[data-spectators]')?.textContent?.trim()).toBe('1 spectator');
    expect(rows[1].textContent).toContain('Computer · Hard');
    expect(rows[1].querySelector('[data-spectators]')?.textContent?.trim()).toBe('4 spectators');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/game/g1?watch=1');
    expect(rows[0].querySelector('a')?.textContent?.trim()).toBe('Watch');
  });

  it('sends a player of a listed game back to their seat', () => {
    TestBed.inject(AuthSession).establish({
      user: { id: 'alice', username: 'alice', elo: 1250 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
    live.mockReturnValue(of({ games: [game('g1')] }));
    const { element } = setup();
    const link = element.querySelector('.game a');
    expect(link?.getAttribute('href')).toBe('/game/g1');
    expect(link?.textContent?.trim()).toBe('Back to your game');
  });

  it('refreshes on demand and on a timer, and stops when the page closes', () => {
    live.mockReturnValue(of({ games: [] }));
    const { fixture, element } = setup();
    expect(element.textContent).toContain('No game is being played right now.');
    expect(live).toHaveBeenCalledTimes(1);
    (element.querySelector('.heading button') as HTMLButtonElement).click();
    expect(live).toHaveBeenCalledTimes(2);
    live.mockReturnValue(of({ games: [game('g1')] }));
    vi.advanceTimersByTime(LIVE_REFRESH_MS);
    fixture.detectChanges();
    expect(live).toHaveBeenCalledTimes(3);
    expect(element.querySelectorAll('.game')).toHaveLength(1);
    fixture.destroy();
    vi.advanceTimersByTime(LIVE_REFRESH_MS * 3);
    expect(live).toHaveBeenCalledTimes(3);
  });

  it('keeps the last list and says so when a refresh fails', () => {
    live.mockReturnValueOnce(of({ games: [game('g1')] }));
    live.mockReturnValueOnce(throwError(() => new Error('down')));
    const { fixture, element } = setup();
    (element.querySelector('.heading button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    expect(element.querySelectorAll('.game')).toHaveLength(1);
  });
});
