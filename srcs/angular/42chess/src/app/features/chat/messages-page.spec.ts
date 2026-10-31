import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import {
  ConnectionState,
  RealtimeService,
  ServerEvent,
} from '../../core/realtime/realtime.service';
import { UsersApi } from '../social/users-api';
import { MESSAGE_MAX_LENGTH, MessagesApi, PrivateMessage } from './messages-api';
import { MessagesPage, SEND_CONFIRM_MS } from './messages-page';

function message(
  id: string,
  senderId: string,
  receiverId: string,
  content: string,
  minute: number,
) {
  return {
    id,
    senderId,
    receiverId,
    content,
    createdAt: new Date(Date.UTC(2026, 9, 31, 10, minute)).toISOString(),
  } satisfies PrivateMessage;
}

describe('Messages page', () => {
  let conversations: ReturnType<typeof vi.fn>;
  let history: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;
  let profile: ReturnType<typeof vi.fn>;
  let events: Subject<ServerEvent>;
  let state: ReturnType<typeof signal<ConnectionState>>;

  beforeEach(() => {
    conversations = vi.fn().mockReturnValue(
      of({
        conversations: [
          {
            user: { id: 'bob', username: 'bob' },
            lastMessage: message('m2', 'bob', 'me', 'See you', 2),
            unreadCount: 1,
          },
          {
            user: { id: 'carol', username: 'carol' },
            lastMessage: message('m9', 'me', 'carol', 'Good game', 1),
            unreadCount: 0,
          },
        ],
      }),
    );
    history = vi.fn().mockReturnValue(
      of({
        messages: [message('m2', 'bob', 'me', 'See you', 2), message('m1', 'me', 'bob', 'Hi', 1)],
        total: 2,
        limit: 30,
        offset: 0,
      }),
    );
    send = vi.fn().mockReturnValue(true);
    profile = vi.fn((id: string) =>
      id === 'ghost'
        ? throwError(
            () =>
              new ApiError(
                new HttpErrorResponse({
                  status: 404,
                  error: { statusCode: 404, code: 'USER_NOT_FOUND' },
                }),
              ),
          )
        : of({
            id,
            username: id,
            avatarUrl: null,
            elo: 1200,
            gamesPlayed: 0,
            online: id !== 'carol',
          }),
    );
    events = new Subject();
    state = signal<ConnectionState>('connected');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'messages', component: MessagesPage },
          { path: 'messages/:userId', component: MessagesPage },
        ]),
        { provide: MessagesApi, useValue: { conversations, history, send } },
        { provide: UsersApi, useValue: { profile } },
        { provide: RealtimeService, useValue: { events: events.asObservable(), state } },
      ],
    });
    TestBed.inject(AuthSession).establish({
      user: { id: 'me', username: 'malice', elo: 1200 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
  });
  afterEach(() => {
    TestBed.inject(AuthSession).clear();
    vi.useRealTimers();
  });

  async function open(url: string) {
    const harness = await RouterTestingHarness.create(url);
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    return { harness, element: harness.routeNativeElement as HTMLElement };
  }

  function inbox(element: HTMLElement) {
    return [...element.querySelectorAll('ul[aria-label="Conversations"] li')].map((row) =>
      [...row.querySelectorAll('strong, .preview, .unread')]
        .map((part) => part.textContent?.trim())
        .join(' '),
    );
  }

  function bubbles(element: HTMLElement) {
    return [...element.querySelectorAll('.bubbles li')].map(
      (row) =>
        `${row.classList.contains('mine') ? '>' : '<'} ${row.querySelector('p')?.textContent}`,
    );
  }

  function type(element: HTMLElement, text: string) {
    const area = element.querySelector('textarea') as HTMLTextAreaElement;
    area.value = text;
    area.dispatchEvent(new Event('input'));
  }

  function button(element: HTMLElement, name: string) {
    return [...element.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === name,
    ) as HTMLButtonElement;
  }

  it('lists conversations newest first with the last message and unread count', async () => {
    const { element } = await open('/messages');
    expect(inbox(element)).toEqual(['bob See you 1', 'carol You: Good game']);
    expect(element.textContent).toContain('Choose a conversation');
    expect(element.querySelector('textarea')).toBeNull();
  });

  it('opens a conversation oldest first and marks it read on this page', async () => {
    const { element } = await open('/messages/bob');
    expect(history).toHaveBeenCalledWith('bob');
    expect(bubbles(element)).toEqual(['> Hi', '< See you']);
    expect(element.querySelector('[role="log"]')?.getAttribute('aria-label')).toBe(
      'Messages with bob',
    );
    expect(inbox(element)[0]).toBe('bob See you');
    expect(element.querySelector('a[aria-current="page"]')?.textContent).toContain('bob');
  });

  it('says when the other player is offline', async () => {
    const { harness, element } = await open('/messages/carol');
    expect(element.querySelector('app-presence-badge')?.textContent).toContain('Offline');
    expect(element.textContent).toContain('carol is offline');
    events.next({ event: 'USER_ONLINE', data: { userId: 'carol', status: 'ONLINE' } });
    harness.detectChanges();
    expect(element.querySelector('app-presence-badge')?.textContent).toContain('Online');
    expect(element.textContent).not.toContain('carol is offline');
  });

  it('sends on the socket and clears the box once the saved message comes back', async () => {
    const { harness, element } = await open('/messages/bob');
    type(element, 'Rematch?');
    harness.detectChanges();
    button(element, 'Send').click();
    harness.detectChanges();
    expect(send).toHaveBeenCalledWith('bob', 'Rematch?');
    expect(button(element, 'Sending…').disabled).toBe(true);
    events.next({ event: 'PRIVATE_MESSAGE', data: message('m3', 'me', 'bob', 'Rematch?', 3) });
    harness.detectChanges();
    expect(bubbles(element)).toEqual(['> Hi', '< See you', '> Rematch?']);
    expect((element.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    expect(inbox(element)[0]).toBe('bob You: Rematch?');
  });

  it('sends with Enter and keeps Shift+Enter for a new line', async () => {
    const { harness, element } = await open('/messages/bob');
    const area = element.querySelector('textarea') as HTMLTextAreaElement;
    type(element, 'line one');
    harness.detectChanges();
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    expect(send).not.toHaveBeenCalled();
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(send).toHaveBeenCalledWith('bob', 'line one');
  });

  it('receives messages live and counts unread ones for other conversations', async () => {
    const { harness, element } = await open('/messages/bob');
    events.next({ event: 'PRIVATE_MESSAGE', data: message('m4', 'bob', 'me', 'Ready', 4) });
    // The same message pushed twice, or found again in history, is shown once.
    events.next({ event: 'PRIVATE_MESSAGE', data: message('m4', 'bob', 'me', 'Ready', 4) });
    events.next({ event: 'PRIVATE_MESSAGE', data: message('m5', 'carol', 'me', 'Hey', 5) });
    harness.detectChanges();
    expect(bubbles(element)).toEqual(['> Hi', '< See you', '< Ready']);
    expect(inbox(element)).toEqual(['carol Hey 1', 'bob Ready']);
  });

  it('reloads the list when a message starts a new conversation', async () => {
    await open('/messages');
    conversations.mockClear();
    events.next({ event: 'PRIVATE_MESSAGE', data: message('m6', 'dave', 'me', 'Hello', 6) });
    expect(conversations).toHaveBeenCalledTimes(1);
  });

  it('keeps the text and explains when the server refuses the message', async () => {
    const { harness, element } = await open('/messages/bob');
    type(element, 'Still there?');
    harness.detectChanges();
    button(element, 'Send').click();
    events.next({ event: 'ERROR', data: { statusCode: 404, code: 'USER_NOT_FOUND' } });
    harness.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('no longer exists');
    expect((element.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Still there?');
    expect(button(element, 'Send').disabled).toBe(false);
  });

  it('does not send while the socket is down', async () => {
    send.mockReturnValue(false);
    const { harness, element } = await open('/messages/bob');
    type(element, 'Hello');
    harness.detectChanges();
    button(element, 'Send').click();
    harness.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('You are offline');
    expect((element.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Hello');
  });

  it('reads history again when an unconfirmed message times out', async () => {
    vi.useFakeTimers();
    const { harness, element } = await open('/messages/bob');
    type(element, 'Anyone?');
    harness.detectChanges();
    button(element, 'Send').click();
    history.mockClear();
    vi.advanceTimersByTime(SEND_CONFIRM_MS);
    harness.detectChanges();
    expect(history).toHaveBeenCalledWith('bob');
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'could not be confirmed',
    );
  });

  it('limits a message to 2000 characters, counting an emoji as one', async () => {
    const { harness, element } = await open('/messages/bob');
    type(element, '👋'.repeat(MESSAGE_MAX_LENGTH));
    harness.detectChanges();
    expect(element.querySelector('.count')?.textContent?.trim()).toBe('2000 / 2000');
    expect(button(element, 'Send').disabled).toBe(false);
    type(element, '👋'.repeat(MESSAGE_MAX_LENGTH + 1));
    harness.detectChanges();
    expect(button(element, 'Send').disabled).toBe(true);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('at most 2000');
    button(element, 'Send').click();
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a blank message', async () => {
    const { harness, element } = await open('/messages/bob');
    type(element, '   \n ');
    harness.detectChanges();
    expect(button(element, 'Send').disabled).toBe(true);
  });

  it('loads older pages without duplicates', async () => {
    history.mockReturnValueOnce(
      of({ messages: [message('m2', 'bob', 'me', 'See you', 2)], total: 2, limit: 30, offset: 0 }),
    );
    const { harness, element } = await open('/messages/bob');
    expect(bubbles(element)).toEqual(['< See you']);
    history.mockReturnValueOnce(
      of({ messages: [message('m1', 'me', 'bob', 'Hi', 1)], total: 2, limit: 30, offset: 1 }),
    );
    button(element, 'Load older messages').click();
    harness.detectChanges();
    expect(history).toHaveBeenLastCalledWith('bob', 1);
    expect(bubbles(element)).toEqual(['> Hi', '< See you']);
    expect(button(element, 'Load older messages')).toBeUndefined();
  });

  it('reads the list and the conversation again after a reconnect', async () => {
    const { harness } = await open('/messages/bob');
    conversations.mockClear();
    history.mockClear();
    state.set('reconnecting');
    harness.detectChanges();
    state.set('connected');
    harness.detectChanges();
    expect(conversations).toHaveBeenCalledTimes(1);
    expect(history).toHaveBeenCalledWith('bob');
  });

  it('explains an unknown player and refuses a conversation with yourself', async () => {
    const { harness, element } = await open('/messages/ghost');
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('does not exist');
    await harness.navigateByUrl('/messages/me');
    harness.detectChanges();
    expect(element.textContent).toContain('cannot send messages to yourself');
    expect(element.querySelector('textarea')).toBeNull();
  });

  it('offers to retry when the conversation list fails', async () => {
    conversations.mockReturnValueOnce(throwError(() => new Error('down')));
    const { harness, element } = await open('/messages');
    expect(element.textContent).toContain('could not be loaded');
    button(element, 'Try again').click();
    harness.detectChanges();
    expect(inbox(element)).toHaveLength(2);
  });
});
