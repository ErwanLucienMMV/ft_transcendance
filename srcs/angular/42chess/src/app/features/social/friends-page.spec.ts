import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import { RealtimeService, ServerEvent } from '../../core/realtime/realtime.service';
import { FriendsPage } from './friends-page';
import { UsersApi } from './users-api';

function apiError(status: number, code: string) {
  return throwError(
    () => new ApiError(new HttpErrorResponse({ status, error: { statusCode: status, code } })),
  );
}

describe('Friends page', () => {
  let search: ReturnType<typeof vi.fn>;
  let friends: ReturnType<typeof vi.fn>;
  let friendRequests: ReturnType<typeof vi.fn>;
  let profile: ReturnType<typeof vi.fn>;
  let acceptFriendRequest: ReturnType<typeof vi.fn>;
  let rejectFriendRequest: ReturnType<typeof vi.fn>;
  let removeFriend: ReturnType<typeof vi.fn>;
  let events: Subject<ServerEvent>;

  beforeEach(() => {
    search = vi.fn().mockReturnValue(
      of({
        users: [
          { id: 'alice', username: 'alice', elo: 1452, online: true },
          { id: 'me', username: 'malice', elo: 1200, online: false },
        ],
      }),
    );
    friends = vi.fn().mockReturnValue(
      of({
        friends: [
          { id: 'bob', username: 'bob', elo: 1300, status: 'ONLINE' },
          { id: 'carol', username: 'carol', elo: 1500, status: 'OFFLINE' },
        ],
      }),
    );
    friendRequests = vi.fn().mockReturnValue(of({ requests: [] }));
    profile = vi.fn((id: string) =>
      id === 'gone'
        ? throwError(() => new Error('down'))
        : of({ id, username: id, avatarUrl: null, elo: 1250, gamesPlayed: 0, online: true }),
    );
    acceptFriendRequest = vi.fn().mockReturnValue(of({}));
    rejectFriendRequest = vi.fn().mockReturnValue(of({}));
    removeFriend = vi.fn().mockReturnValue(of(undefined));
    events = new Subject();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'friends', component: FriendsPage }]),
        {
          provide: UsersApi,
          useValue: {
            search,
            friends,
            friendRequests,
            profile,
            acceptFriendRequest,
            rejectFriendRequest,
            removeFriend,
          },
        },
        { provide: RealtimeService, useValue: { events: events.asObservable() } },
      ],
    });
    TestBed.inject(AuthSession).establish({
      user: { id: 'me', username: 'malice', elo: 1200 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
  });
  afterEach(() => TestBed.inject(AuthSession).clear());

  async function open(url = '/friends') {
    const harness = await RouterTestingHarness.create(url);
    harness.detectChanges();
    return { harness, element: harness.routeNativeElement as HTMLElement };
  }

  function rows(element: HTMLElement, label: string) {
    return [...element.querySelectorAll(`ul[aria-label="${label}"] li`)].map((row) =>
      [...row.querySelectorAll('strong, small, .elo, app-presence-badge')]
        .map((part) => part.textContent?.trim())
        .filter(Boolean)
        .join(' '),
    );
  }

  it('lists friends with their Elo and presence, and follows pushed changes', async () => {
    const { harness, element } = await open();
    expect(search).not.toHaveBeenCalled();
    expect(rows(element, 'Friends')).toEqual(['bob 1300 Online', 'carol 1500 Offline']);
    expect(element.querySelector('ul[aria-label="Friends"] a')?.getAttribute('href')).toBe(
      '/players/bob',
    );
    events.next({ event: 'USER_STATUS_CHANGED', data: { userId: 'bob', status: 'IN_GAME' } });
    events.next({ event: 'USER_ONLINE', data: { userId: 'carol', status: 'ONLINE' } });
    harness.detectChanges();
    expect(rows(element, 'Friends')).toEqual(['bob 1300 In a game', 'carol 1500 Online']);
  });

  it('searches from the address, marks the signed-in user and links to profiles', async () => {
    const { element } = await open('/friends?q=%20alice%20');
    expect(search).toHaveBeenCalledWith('alice');
    expect((element.querySelector('#player-search') as HTMLInputElement).value).toBe('alice');
    expect(rows(element, 'Search results')).toEqual([
      'alice 1452 Online',
      'malice (you) 1200 Offline',
    ]);
    expect(element.querySelector('ul[aria-label="Search results"] a')?.getAttribute('href')).toBe(
      '/players/alice',
    );
  });

  it('puts a submitted search in the address and explains an empty result', async () => {
    search.mockReturnValue(of({ users: [] }));
    const { harness, element } = await open();
    const input = element.querySelector('#player-search') as HTMLInputElement;
    input.value = '  zed ';
    input.dispatchEvent(new Event('input'));
    (element.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/friends?q=zed');
    expect(search).toHaveBeenCalledWith('zed');
    expect(element.querySelector('[role="status"]')?.textContent).toContain('No player matches');
  });

  it('offers a retry when the friend list cannot be read', async () => {
    friends.mockReturnValueOnce(throwError(() => new Error('down')));
    const { harness, element } = await open();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Your friends could not be loaded.',
    );
    (element.querySelector('[role="alert"] button') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(rows(element, 'Friends')).toHaveLength(2);
  });

  function request(id: string, senderId: string) {
    return {
      id,
      senderId,
      recipientId: 'me',
      status: 'PENDING',
      createdAt: '2026-10-29T08:00:00.000Z',
    };
  }

  function button(element: HTMLElement, name: string, index = 0) {
    return [...element.querySelectorAll('button')].filter(
      (item) => item.textContent?.trim() === name,
    )[index] as HTMLButtonElement;
  }

  it('shows incoming requests with the sender name, even when one profile cannot be read', async () => {
    friendRequests.mockReturnValue(
      of({ requests: [request('r1', 'dave'), request('r2', 'gone')] }),
    );
    const { element } = await open();
    expect(profile).toHaveBeenCalledWith('dave');
    expect(rows(element, 'Friend requests')).toEqual(['dave 1250', 'A player']);
    expect(element.querySelector('ul[aria-label="Friend requests"] a')?.getAttribute('href')).toBe(
      '/players/dave',
    );
  });

  it('accepts a request, then reloads the friend list; declines another', async () => {
    friendRequests.mockReturnValue(
      of({ requests: [request('r1', 'dave'), request('r2', 'erin')] }),
    );
    const { harness, element } = await open();
    friends.mockReturnValue(
      of({ friends: [{ id: 'dave', username: 'dave', elo: 1250, status: 'ONLINE' }] }),
    );
    button(element, 'Accept').click();
    harness.detectChanges();
    expect(acceptFriendRequest).toHaveBeenCalledWith('r1');
    expect(rows(element, 'Friends')).toEqual(['dave 1250 Online']);
    expect(rows(element, 'Friend requests')).toEqual(['erin 1250']);
    button(element, 'Decline').click();
    harness.detectChanges();
    expect(rejectFriendRequest).toHaveBeenCalledWith('r2');
    expect(element.querySelector('ul[aria-label="Friend requests"]')).toBeNull();
  });

  it('drops a request that was resolved elsewhere and says so', async () => {
    friendRequests.mockReturnValue(of({ requests: [request('r1', 'dave')] }));
    acceptFriendRequest.mockReturnValue(apiError(409, 'FRIEND_REQUEST_FINALIZED'));
    const { harness, element } = await open();
    button(element, 'Accept').click();
    harness.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toBe(
      'This request is no longer pending.',
    );
    expect(element.querySelector('ul[aria-label="Friend requests"]')).toBeNull();
  });

  it('removes a friend only after confirmation', async () => {
    const { harness, element } = await open();
    (element.querySelector('button[aria-label="Remove bob"]') as HTMLButtonElement).click();
    harness.detectChanges();
    button(element, 'Cancel').click();
    harness.detectChanges();
    expect(removeFriend).not.toHaveBeenCalled();
    (element.querySelector('button[aria-label="Remove bob"]') as HTMLButtonElement).click();
    harness.detectChanges();
    button(element, 'Confirm removal').click();
    harness.detectChanges();
    expect(removeFriend).toHaveBeenCalledWith('bob');
    expect(rows(element, 'Friends')).toEqual(['carol 1500 Offline']);
  });
});
