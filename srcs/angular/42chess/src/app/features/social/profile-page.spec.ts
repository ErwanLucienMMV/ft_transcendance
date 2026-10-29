import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import { SessionLifecycle } from '../../core/auth/session-lifecycle';
import { RealtimeService, ServerEvent } from '../../core/realtime/realtime.service';
import { GamesApi } from '../game/games-api';
import { ProfilePage } from './profile-page';
import { PublicProfile, UsersApi } from './users-api';

const alice: PublicProfile = {
  id: 'alice',
  username: 'alice',
  avatarUrl: null,
  elo: 1452,
  gamesPlayed: 3,
  online: true,
};

const aliceAccount = {
  ...alice,
  gamesWon: 2,
  gamesDraw: 0,
  gamesLost: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
};

describe('Player profile page', () => {
  let profile: ReturnType<typeof vi.fn>;
  let ratingHistory: ReturnType<typeof vi.fn>;
  let history: ReturnType<typeof vi.fn>;
  let refreshUser: ReturnType<typeof vi.fn>;
  let events: Subject<ServerEvent>;

  beforeEach(() => {
    profile = vi.fn().mockReturnValue(of(alice));
    ratingHistory = vi.fn().mockReturnValue(
      of({
        history: [
          {
            gameId: 'g2',
            ratingBefore: 1440,
            ratingAfter: 1452,
            change: 12,
            createdAt: '2026-10-28T10:00:00.000Z',
          },
          {
            gameId: 'g1',
            ratingBefore: 1450,
            ratingAfter: 1440,
            change: -10,
            createdAt: '2026-10-27T10:00:00.000Z',
          },
        ],
      }),
    );
    history = vi.fn().mockReturnValue(
      of({
        items: [
          {
            id: 'g2',
            color: 'WHITE',
            opponent: { id: 'bob', username: 'bob', avatarUrl: null, elo: 1300, color: 'BLACK' },
            outcome: 'WIN',
            reason: 'CHECKMATE',
            timeControl: { initialTime: 600_000, increment: 0 },
            moveCount: 9,
            startedAt: '2026-10-28T09:50:00.000Z',
            endedAt: '2026-10-28T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 5,
        offset: 0,
      }),
    );
    refreshUser = vi.fn().mockReturnValue(of(aliceAccount));
    events = new Subject();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'players/:id', component: ProfilePage }]),
        { provide: UsersApi, useValue: { profile, ratingHistory } },
        { provide: GamesApi, useValue: { history } },
        { provide: SessionLifecycle, useValue: { refreshUser } },
        { provide: RealtimeService, useValue: { events: events.asObservable() } },
      ],
    });
  });
  afterEach(() => TestBed.inject(AuthSession).clear());

  function signIn(id: string) {
    TestBed.inject(AuthSession).establish({
      user: { id, username: id, elo: 1200 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
  }

  async function open(url: string) {
    const harness = await RouterTestingHarness.create(url);
    harness.detectChanges();
    return { harness, element: harness.routeNativeElement as HTMLElement };
  }

  it('shows a public profile with Elo, presence, rating changes and recent games', async () => {
    const { element } = await open('/players/alice');
    expect(profile).toHaveBeenCalledWith('alice');
    expect(ratingHistory).toHaveBeenCalledWith('alice', 10);
    expect(history).toHaveBeenCalledWith('alice', 5, 0);
    expect(refreshUser).not.toHaveBeenCalled();
    expect(element.querySelector('h2')?.textContent).toBe('alice');
    expect(element.querySelector('.initial')?.textContent?.trim()).toBe('A');
    expect(element.querySelector('app-presence-badge')?.textContent?.trim()).toBe('Online');
    const stats = [...element.querySelectorAll('.stats div')].map(
      (item) => `${item.querySelector('dt')?.textContent} ${item.querySelector('dd')?.textContent}`,
    );
    expect(stats).toEqual(['Elo 1452', 'Games 3']);
    const changes = [...element.querySelectorAll('[aria-labelledby="rating-title"] li a')];
    expect(changes.map((row) => row.querySelector('.change')?.textContent?.trim())).toEqual([
      '+12',
      '-10',
    ]);
    expect(changes[0].getAttribute('href')).toBe('/replay/g2');
    expect(changes[0].textContent).toContain('1440 → 1452');
    const games = element.querySelector('[aria-labelledby="recent-title"] li a');
    expect(games?.textContent).toContain('Won');
    expect(games?.textContent).toContain('vs bob (1300)');
    expect(element.querySelector('a[href="/session"]')).toBeNull();
  });

  it('adds results and account links on the signed-in user own profile', async () => {
    signIn('alice');
    // Like the real one, the refresh replaces the session user with a new object.
    const session = TestBed.inject(AuthSession);
    refreshUser.mockImplementation(() => {
      session.updateUser({ id: 'alice', username: 'alice', elo: 1452 }, session.token()!);
      return of(aliceAccount);
    });
    const { harness, element } = await open('/players/alice');
    await harness.fixture.whenStable();
    expect(refreshUser).toHaveBeenCalledTimes(1);
    expect(profile).toHaveBeenCalledTimes(1);
    expect(element.querySelector('.eyebrow')?.textContent).toBe('Your profile');
    const stats = [...element.querySelectorAll('.stats dt')].map((term) => term.textContent);
    expect(stats).toEqual(['Elo', 'Games', 'Won', 'Drawn', 'Lost']);
    expect(element.querySelector('a[href="/session"]')?.textContent).toBe('Account settings');
    expect(element.querySelector('a[href="/history"]')).not.toBeNull();
  });

  it('follows pushed presence changes of the profile owner only', async () => {
    const { harness, element } = await open('/players/alice');
    events.next({ event: 'USER_STATUS_CHANGED', data: { userId: 'bob', status: 'OFFLINE' } });
    harness.detectChanges();
    expect(element.querySelector('app-presence-badge')?.textContent?.trim()).toBe('Online');
    events.next({ event: 'USER_STATUS_CHANGED', data: { userId: 'alice', status: 'IN_GAME' } });
    harness.detectChanges();
    expect(element.querySelector('app-presence-badge')?.textContent?.trim()).toBe('In a game');
  });

  it('explains an unknown player', async () => {
    profile.mockReturnValue(
      throwError(
        () =>
          new ApiError(
            new HttpErrorResponse({
              status: 404,
              error: { statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' },
            }),
          ),
      ),
    );
    const missing = await open('/players/ghost');
    expect(missing.element.querySelector('[role="alert"]')?.textContent).toBe(
      'This player does not exist.',
    );
  });

  it('still shows the profile when rating and game lists cannot be read', async () => {
    ratingHistory.mockReturnValue(throwError(() => new Error('down')));
    history.mockReturnValue(throwError(() => new Error('down')));
    const { element } = await open('/players/alice');
    expect(element.querySelector('h2')?.textContent).toBe('alice');
    expect(element.textContent).toContain('Rating changes could not be loaded.');
    expect(element.textContent).toContain('Recent games could not be loaded.');
  });
});
