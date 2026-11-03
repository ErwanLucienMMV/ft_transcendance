import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { Subject } from 'rxjs';
import { RealtimeService, ServerEvent } from '../realtime/realtime.service';
import { CHALLENGE_NOTICE_MS, noticeFor, SocialNotices } from './social-notices';

@Component({ template: '' })
class Blank {}

const challenge: ServerEvent = {
  event: 'CHALLENGE_RECEIVED',
  data: {
    gameId: 'g1',
    from: { id: 'bob', username: 'bob', avatarUrl: null, elo: 1300 },
    initialTime: 600_000,
    increment: 0,
    rated: false,
  },
};
const request: ServerEvent = {
  event: 'FRIEND_REQUEST_RECEIVED',
  data: {
    request: { id: 'r1', senderId: 'carol', recipientId: 'me', status: 'PENDING', createdAt: '' },
    sender: { id: 'carol', username: 'carol', avatarUrl: null, elo: 1200 },
  },
};

describe('Social notices', () => {
  let events: Subject<ServerEvent>;

  beforeEach(() => {
    events = new Subject();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: Blank },
          { path: 'friends', component: Blank },
          { path: 'game/:id', component: Blank },
        ]),
        {
          provide: RealtimeService,
          useValue: { events: events.asObservable(), state: signal('connected') },
        },
      ],
    });
  });
  afterEach(() => vi.useRealTimers());

  it('describes challenges and friend requests, and ignores anything else', () => {
    expect(noticeFor(challenge)).toMatchObject({
      kind: 'challenge',
      text: 'bob challenges you to a 10 + 0 game.',
      link: ['/game', 'g1'],
    });
    expect(noticeFor({ ...challenge, data: { ...challenge.data, rated: true } })?.text).toContain(
      'rated game',
    );
    expect(noticeFor(request)).toMatchObject({
      kind: 'friend-request',
      text: 'carol wants to be your friend.',
      link: ['/friends'],
    });
    expect(noticeFor({ event: 'CHALLENGE_RECEIVED', data: { gameId: 'g1' } })).toBeNull();
    expect(noticeFor({ event: 'USER_ONLINE', data: { userId: 'a' } })).toBeNull();
  });

  it('shows a notice with a link, dismisses it, and lets it expire', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(SocialNotices);
    const element: HTMLElement = fixture.nativeElement;
    events.next(challenge);
    events.next(request);
    fixture.detectChanges();
    const notices = () => [...element.querySelectorAll('.notice p')].map((p) => p.textContent);
    expect(notices()).toEqual([
      'bob challenges you to a 10 + 0 game.',
      'carol wants to be your friend.',
    ]);
    expect(element.querySelector('.notice a')?.getAttribute('href')).toBe('/game/g1');
    element.querySelector<HTMLButtonElement>('.notice button')!.click();
    fixture.detectChanges();
    expect(notices()).toEqual(['carol wants to be your friend.']);
    vi.advanceTimersByTime(CHALLENGE_NOTICE_MS);
    fixture.detectChanges();
    expect(notices()).toEqual([]);
  });

  it('stays quiet on the page that already shows the news, and clears on reaching it', async () => {
    const fixture = TestBed.createComponent(SocialNotices);
    const element: HTMLElement = fixture.nativeElement;
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/friends');
    events.next(request);
    fixture.detectChanges();
    expect(element.querySelector('.notice')).toBeNull();
    await router.navigateByUrl('/');
    events.next(challenge);
    fixture.detectChanges();
    expect(element.querySelectorAll('.notice')).toHaveLength(1);
    await router.navigateByUrl('/game/g1');
    fixture.detectChanges();
    expect(element.querySelector('.notice')).toBeNull();
  });
});
