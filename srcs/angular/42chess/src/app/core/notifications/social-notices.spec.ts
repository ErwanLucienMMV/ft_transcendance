import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthSession } from '../auth/auth-session';
import { RealtimeService, ServerEvent } from '../realtime/realtime.service';
import {
  CHALLENGE_NOTICE_MS,
  noticeFor,
  PROGRESS_NOTICE_MS,
  SocialNotices,
} from './social-notices';

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
const achievement: ServerEvent = {
  event: 'ACHIEVEMENT_UNLOCKED',
  data: {
    code: 'FIRST_WIN',
    name: 'First victory',
    description: 'Win a game against another player.',
    goal: 1,
    xp: 20,
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
  afterEach(() => {
    vi.useRealTimers();
    TestBed.inject(AuthSession).clear();
  });

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

  it('describes achievements and new levels with a link to the player profile', () => {
    expect(noticeFor(achievement, 'me')).toMatchObject({
      kind: 'achievement',
      title: 'Achievement unlocked',
      text: 'First victory: Win a game against another player. +20 XP.',
      link: ['/players', 'me'],
      fragment: 'achievements',
    });
    expect(noticeFor({ event: 'LEVEL_UP', data: { level: 3, xp: 320 } }, 'me')).toMatchObject({
      kind: 'level',
      text: 'You reached level 3.',
      fragment: 'progression',
    });
    // Without a signed-in player there is no profile to link to.
    expect(noticeFor(achievement)).toBeNull();
    expect(noticeFor({ event: 'LEVEL_UP', data: { level: 'x' } }, 'me')).toBeNull();
  });

  it('lets a burst of progress notices make room among themselves, never over a challenge', () => {
    TestBed.inject(AuthSession).establish({
      user: { id: 'me', username: 'me', elo: 1200 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
    const fixture = TestBed.createComponent(SocialNotices);
    const element: HTMLElement = fixture.nativeElement;
    events.next(challenge);
    for (const code of ['FIRST_GAME', 'FIRST_WIN', 'BOT_EASY', 'GAMES_10'])
      events.next({ ...achievement, data: { ...achievement.data, code, name: code } });
    fixture.detectChanges();
    const kinds = [...element.querySelectorAll('.notice')].map((notice) =>
      notice.getAttribute('data-kind'),
    );
    expect(kinds).toEqual(['challenge', 'achievement', 'achievement']);
    expect(element.textContent).toContain('Regular');
    expect(element.textContent).toContain('bob challenges you');
  });

  it('shows progress notices with a badge, even on the profile page', async () => {
    vi.useFakeTimers();
    TestBed.inject(AuthSession).establish({
      user: { id: 'me', username: 'me', elo: 1200 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
    const fixture = TestBed.createComponent(SocialNotices);
    const element: HTMLElement = fixture.nativeElement;
    events.next(achievement);
    fixture.detectChanges();
    expect(element.querySelector('.notice-body strong')?.textContent).toBe('Achievement unlocked');
    expect(element.querySelector('.notice-badge')).not.toBeNull();
    expect(element.querySelector('.notice a')?.getAttribute('href')).toBe(
      '/players/me#achievements',
    );
    vi.advanceTimersByTime(PROGRESS_NOTICE_MS);
    fixture.detectChanges();
    expect(element.querySelector('.notice')).toBeNull();
  });
});
