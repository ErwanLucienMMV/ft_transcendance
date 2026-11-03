import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { API_BASE_URL } from '../api/api-base-url';
import { AuthSession } from '../auth/auth-session';
import { ConnectionState, RealtimeService, ServerEvent } from '../realtime/realtime.service';
import { UnreadMessages } from './unread-messages';

const message = (senderId: string): ServerEvent => ({
  event: 'PRIVATE_MESSAGE',
  data: { senderId, receiverId: 'me' },
});
const list = (counts: Record<string, number>) => ({
  conversations: Object.entries(counts).map(([id, unreadCount]) => ({
    user: { id },
    unreadCount,
  })),
});

describe('Unread messages', () => {
  let events: Subject<ServerEvent>;
  let state: ReturnType<typeof signal<ConnectionState>>;

  function setup() {
    TestBed.inject(AuthSession).establish({
      user: { id: 'me', username: 'me', elo: 1200 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
    const unread = TestBed.inject(UnreadMessages);
    TestBed.tick();
    return { unread, http: TestBed.inject(HttpTestingController) };
  }

  beforeEach(() => {
    events = new Subject();
    state = signal<ConnectionState>('connected');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
        { provide: RealtimeService, useValue: { events: events.asObservable(), state } },
      ],
    });
  });
  afterEach(() => TestBed.inject(AuthSession).clear());

  it('counts a message that arrives while the list loads, once', () => {
    const { unread, http } = setup();
    const request = http.expectOne('/api/v1/conversations');
    // Bob's message is not in the list yet; Carol's already is.
    events.next(message('bob'));
    events.next(message('carol'));
    request.flush(list({ carol: 1, dave: 2 }));
    expect(unread.total()).toBe(4);
  });

  it('loads the counts again after a reconnection', () => {
    const { unread, http } = setup();
    http.expectOne('/api/v1/conversations').flush(list({ bob: 1 }));
    state.set('reconnecting');
    TestBed.tick();
    http.expectNone('/api/v1/conversations');
    // Two messages were sent while this page was offline.
    state.set('connected');
    TestBed.tick();
    http.expectOne('/api/v1/conversations').flush(list({ bob: 3 }));
    expect(unread.total()).toBe(3);
  });
});
