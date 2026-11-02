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
import { ProgressionApi } from '../progression/progression-api';
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

const aliceStats = {
  rank: 4,
  rankedPlayers: 20,
  rated: { played: 3, won: 2, drawn: 0, lost: 1 },
  casual: { played: 1, won: 0, drawn: 1, lost: 0 },
  bots: { played: 2, won: 1, drawn: 0, lost: 1 },
  progression: { xp: 150, level: 2, levelXp: 100, nextLevelXp: 300 },
  puzzles: { solved: 4, streak: 3, bestStreak: 5, solvedToday: true },
};
const aliceAchievements = [
  {
    code: 'FIRST_WIN',
    name: 'First victory',
    description: 'Win a game against another player.',
    goal: 1,
    xp: 20,
    progress: 1,
    unlockedAt: '2026-10-28T10:00:00.000Z',
  },
  {
    code: 'GAMES_10',
    name: 'Regular',
    description: 'Finish 10 games against other players.',
    goal: 10,
    xp: 30,
    progress: 4,
    unlockedAt: null,
  },
];

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
  let friends: ReturnType<typeof vi.fn>;
  let sendFriendRequest: ReturnType<typeof vi.fn>;
  let friendRequests: ReturnType<typeof vi.fn>;
  let sentFriendRequests: ReturnType<typeof vi.fn>;
  let acceptFriendRequest: ReturnType<typeof vi.fn>;
  let removeFriendRequest: ReturnType<typeof vi.fn>;
  let blocked: ReturnType<typeof vi.fn>;
  let block: ReturnType<typeof vi.fn>;
  let unblock: ReturnType<typeof vi.fn>;
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
    friends = vi.fn().mockReturnValue(of({ friends: [] }));
    sendFriendRequest = vi.fn().mockReturnValue(of({ id: 'r1', status: 'PENDING' }));
    friendRequests = vi.fn().mockReturnValue(of({ requests: [] }));
    sentFriendRequests = vi.fn().mockReturnValue(of({ requests: [] }));
    acceptFriendRequest = vi.fn().mockReturnValue(of({}));
    removeFriendRequest = vi.fn().mockReturnValue(of(undefined));
    blocked = vi.fn().mockReturnValue(of({ users: [] }));
    block = vi.fn().mockReturnValue(of(undefined));
    unblock = vi.fn().mockReturnValue(of(undefined));
    events = new Subject();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'players/:id', component: ProfilePage }]),
        {
          provide: UsersApi,
          useValue: {
            profile,
            ratingHistory,
            friends,
            sendFriendRequest,
            friendRequests,
            sentFriendRequests,
            acceptFriendRequest,
            removeFriendRequest,
            blocked,
            block,
            unblock,
          },
        },
        { provide: GamesApi, useValue: { history } },
        {
          provide: ProgressionApi,
          useValue: {
            stats: vi.fn(() => of(aliceStats)),
            achievements: vi.fn(() => of({ achievements: aliceAchievements })),
          },
        },
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
    expect(ratingHistory).toHaveBeenCalledWith('alice', 100);
    expect(history).toHaveBeenCalledWith('alice', 5, 0);
    expect(refreshUser).not.toHaveBeenCalled();
    expect(element.querySelector('h2')?.textContent).toBe('alice');
    expect(element.querySelector('.initial')?.textContent?.trim()).toBe('A');
    expect(element.querySelector('app-presence-badge')?.textContent?.trim()).toBe('Online');
    const stats = [...element.querySelectorAll('.stats div')].map(
      (item) => `${item.querySelector('dt')?.textContent} ${item.querySelector('dd')?.textContent}`,
    );
    expect(stats.map((item) => item.replace(/\s+/g, ' ').trim())).toEqual([
      'Rating 1452',
      'Rank #4 of 20',
      'Level 2',
      'Puzzle streak 3 days, best 5',
    ]);
    expect(element.querySelector('.stats a')?.getAttribute('href')).toBe('/leaderboard?rank=4');
    const results = [...element.querySelectorAll('.results tbody tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent?.trim()).join(' '),
    );
    expect(results).toEqual(['Rated 3 2 0 1', 'Casual 1 0 1 0', 'Computer 2 1 0 1']);
    expect(
      element.querySelector('app-level-bar [role="progressbar"]')?.getAttribute('aria-valuetext'),
    ).toBe('150 XP to level 3');
    expect(element.querySelector('#achievements h3')?.textContent).toContain('1 of 2 unlocked');
    expect(element.querySelector('#achievements li.unlocked strong')?.textContent).toBe(
      'First victory',
    );
    expect(
      element.querySelector('#achievements [role="progressbar"]')?.getAttribute('aria-valuenow'),
    ).toBe('4');
    expect(element.querySelector('app-elo-chart svg')?.getAttribute('aria-label')).toBe(
      'Rating over the last 2 rated games: from 1450 to 1452, lowest 1440, highest 1452.',
    );
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

  it('adds account links on the signed-in user own profile and refreshes the header', async () => {
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
    expect(element.querySelector('a[href="/settings"]')?.textContent).toBe('Account settings');
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

  it('offers no friend action to visitors who are signed out or on their own profile', async () => {
    const { element } = await open('/players/alice');
    expect(friends).not.toHaveBeenCalled();
    expect(element.textContent).not.toContain('Add friend');
    expect(element.querySelector('a[href^="/messages"]')).toBeNull();
  });

  it('links a signed-in visitor to a conversation, but not on their own profile', async () => {
    signIn('me');
    const { harness, element } = await open('/players/alice');
    expect(element.querySelector('a[href="/messages/alice"]')?.textContent?.trim()).toBe('Message');
    await harness.navigateByUrl('/players/me');
    harness.detectChanges();
    expect(element.querySelector('a[href^="/messages"]')).toBeNull();
  });

  it('sends a friend request from the profile of a non-friend', async () => {
    signIn('me');
    const { harness, element } = await open('/players/alice');
    const add = [...element.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === 'Add friend',
    ) as HTMLButtonElement;
    add.click();
    harness.detectChanges();
    expect(sendFriendRequest).toHaveBeenCalledWith('alice');
    expect(element.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Friend request sent.',
    );
  });

  it('knows an existing friend and explains a request already pending', async () => {
    signIn('me');
    friends.mockReturnValue(
      of({ friends: [{ id: 'alice', username: 'alice', elo: 1452, status: 'ONLINE' }] }),
    );
    const friend = await open('/players/alice');
    expect(friend.element.textContent).toContain('You are friends.');
    expect(friend.element.textContent).not.toContain('Add friend');
  });

  it('turns the pending and already-friends refusals into explanations', async () => {
    signIn('me');
    sendFriendRequest.mockReturnValue(
      throwError(
        () =>
          new ApiError(
            new HttpErrorResponse({
              status: 409,
              error: { statusCode: 409, code: 'FRIEND_REQUEST_PENDING' },
            }),
          ),
      ),
    );
    const { harness, element } = await open('/players/alice');
    (
      [...element.querySelectorAll('button')].find(
        (item) => item.textContent?.trim() === 'Add friend',
      ) as HTMLButtonElement
    ).click();
    harness.detectChanges();
    expect(element.querySelector('[role="status"]')?.textContent).toContain(
      'A friend request between you is already pending.',
    );
    expect(element.querySelector('a[href="/friends"]')).not.toBeNull();
  });

  function pendingRequest(id: string, senderId: string, recipientId: string) {
    return { id, senderId, recipientId, status: 'PENDING', createdAt: '2026-11-01T00:00:00.000Z' };
  }

  function button(element: HTMLElement, name: string) {
    return [...element.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === name,
    ) as HTMLButtonElement;
  }

  it('cancels a request this visitor sent', async () => {
    signIn('me');
    sentFriendRequests.mockReturnValue(of({ requests: [pendingRequest('r1', 'me', 'alice')] }));
    const { harness, element } = await open('/players/alice');
    expect(element.textContent).toContain('Friend request sent.');
    button(element, 'Cancel request').click();
    harness.detectChanges();
    expect(removeFriendRequest).toHaveBeenCalledWith('r1');
    expect(button(element, 'Add friend')).toBeDefined();
  });

  it('answers a request from the profile owner', async () => {
    signIn('me');
    friendRequests.mockReturnValue(of({ requests: [pendingRequest('r2', 'alice', 'me')] }));
    const { harness, element } = await open('/players/alice');
    expect(element.textContent).toContain('alice sent you a friend request.');
    button(element, 'Accept').click();
    harness.detectChanges();
    expect(acceptFriendRequest).toHaveBeenCalledWith('r2');
    expect(element.textContent).toContain('You are friends.');
  });

  it('says so when a request answered theirs and made you friends at once', async () => {
    signIn('me');
    sendFriendRequest.mockReturnValue(of({ id: 'r3', status: 'ACCEPTED' }));
    const { harness, element } = await open('/players/alice');
    button(element, 'Add friend').click();
    harness.detectChanges();
    expect(element.textContent).toContain('alice had already asked: you are now friends.');
  });

  it('explains the waiting time after a declined request', async () => {
    signIn('me');
    sendFriendRequest.mockReturnValue(
      throwError(
        () =>
          new ApiError(
            new HttpErrorResponse({
              status: 409,
              error: { statusCode: 409, code: 'FRIEND_REQUEST_DECLINED_RECENTLY' },
            }),
          ),
      ),
    );
    const { harness, element } = await open('/players/alice');
    button(element, 'Add friend').click();
    harness.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'You can ask again in a few days.',
    );
  });

  it('follows a request answered by the profile owner while the page is open', async () => {
    signIn('me');
    sentFriendRequests.mockReturnValue(of({ requests: [pendingRequest('r1', 'me', 'alice')] }));
    const { harness, element } = await open('/players/alice');
    events.next({
      event: 'FRIEND_ADDED',
      data: {
        requestId: 'r1',
        friend: { id: 'alice', username: 'alice', avatarUrl: null, elo: 1452, status: 'ONLINE' },
      },
    });
    harness.detectChanges();
    expect(element.textContent).toContain('You are friends.');
    events.next({ event: 'FRIEND_REMOVED', data: { userId: 'alice' } });
    harness.detectChanges();
    expect(button(element, 'Add friend')).toBeDefined();
  });

  it('blocks after confirmation and hides every contact action until unblocked', async () => {
    signIn('me');
    const { harness, element } = await open('/players/alice');
    button(element, 'Block player').click();
    harness.detectChanges();
    expect(block).not.toHaveBeenCalled();
    expect(element.textContent).toContain('They are not told.');
    button(element, 'Block').click();
    harness.detectChanges();
    expect(block).toHaveBeenCalledWith('alice');
    expect(element.textContent).toContain('You blocked this player.');
    expect(button(element, 'Add friend')).toBeUndefined();
    expect(element.querySelector('a[href="/messages/alice"]')).toBeNull();
    button(element, 'Unblock').click();
    harness.detectChanges();
    expect(unblock).toHaveBeenCalledWith('alice');
    expect(button(element, 'Add friend')).toBeDefined();
  });

  it('knows a player this visitor blocked', async () => {
    signIn('me');
    blocked.mockReturnValue(
      of({ users: [{ id: 'alice', username: 'alice', avatarUrl: null, blockedAt: '' }] }),
    );
    const { element } = await open('/players/alice');
    expect(element.textContent).toContain('You blocked this player.');
    expect(button(element, 'Unblock')).toBeDefined();
  });
});
