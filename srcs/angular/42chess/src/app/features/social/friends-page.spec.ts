import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import { RealtimeService, ServerEvent } from '../../core/realtime/realtime.service';
import { FriendsPage } from './friends-page';
import { UsersApi } from './users-api';

describe('Friends page', () => {
  let search: ReturnType<typeof vi.fn>;
  let friends: ReturnType<typeof vi.fn>;
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
    events = new Subject();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'friends', component: FriendsPage }]),
        { provide: UsersApi, useValue: { search, friends } },
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
});
