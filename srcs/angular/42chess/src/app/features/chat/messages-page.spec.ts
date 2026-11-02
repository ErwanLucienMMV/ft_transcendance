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
import { Challenges } from '../social/challenge';
import { UsersApi } from '../social/users-api';
import { MESSAGE_MAX_LENGTH, MessagePage, MessagesApi, PrivateMessage } from './messages-api';
import { MessagesPage, SEND_CONFIRM_MS } from './messages-page';
import { UnreadMessages } from '../../core/notifications/unread-messages';

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
  let markRead: ReturnType<typeof vi.fn>;
  let unreadMessages: { clear: ReturnType<typeof vi.fn> };
  let typing: ReturnType<typeof vi.fn>;
  let blocked: ReturnType<typeof vi.fn>;
  let block: ReturnType<typeof vi.fn>;
  let unblock: ReturnType<typeof vi.fn>;
  let challenge: ReturnType<typeof vi.fn>;
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
    markRead = vi.fn().mockReturnValue(of(undefined));
    typing = vi.fn();
    blocked = vi.fn().mockReturnValue(of({ users: [] }));
    block = vi.fn().mockReturnValue(of(undefined));
    unblock = vi.fn().mockReturnValue(of(undefined));
    challenge = vi.fn().mockReturnValue(of(undefined));
    events = new Subject();
    state = signal<ConnectionState>('connected');
    unreadMessages = { clear: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'messages', component: MessagesPage },
          { path: 'messages/:userId', component: MessagesPage },
        ]),
        { provide: MessagesApi, useValue: { conversations, history, send, markRead, typing } },
        { provide: UsersApi, useValue: { profile, blocked, block, unblock } },
        { provide: Challenges, useValue: { send: challenge } },
        { provide: RealtimeService, useValue: { events: events.asObservable(), state } },
        { provide: UnreadMessages, useValue: unreadMessages },
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
    // The server is told, so the count stays at zero in every tab and for bob.
    expect(markRead).toHaveBeenCalledExactlyOnceWith('bob');
    // The header badge drops at once.
    expect(unreadMessages.clear).toHaveBeenCalledWith('bob');
  });

  it('marks again a message that arrived while the conversation was being marked read', async () => {
    const pending = new Subject<void>();
    markRead.mockReturnValueOnce(pending);
    const { harness } = await open('/messages/bob');
    events.next({ event: 'PRIVATE_MESSAGE', data: message('m9', 'bob', 'me', 'Still there?', 9) });
    await harness.fixture.whenStable();
    expect(markRead).toHaveBeenCalledTimes(1);
    pending.next();
    pending.complete();
    await harness.fixture.whenStable();
    expect(markRead).toHaveBeenCalledTimes(2);
  });

  it('does not mark a conversation read when nothing in it is unread', async () => {
    await open('/messages/carol');
    expect(markRead).not.toHaveBeenCalled();
  });

  it('shows Sent, then Read under the last message this account sent', async () => {
    history.mockReturnValue(
      of({
        messages: [message('m1', 'me', 'bob', 'Hi', 1)],
        total: 1,
        limit: 30,
        offset: 0,
      }),
    );
    const { harness, element } = await open('/messages/bob');
    expect(element.querySelector('.receipt')?.textContent?.trim()).toBe('Sent');
    events.next({
      event: 'MESSAGES_READ',
      data: {
        readerId: 'bob',
        senderId: 'me',
        readAt: '2026-10-31T10:05:00.000Z',
        messageIds: ['m1'],
      },
    });
    harness.detectChanges();
    expect(element.querySelector('.receipt')?.textContent).toContain('Read');
    expect(element.querySelector('.receipt')?.classList).toContain('read');
  });

  it('clears the unread count when another tab reads the conversation', async () => {
    const { harness, element } = await open('/messages');
    expect(inbox(element)[0]).toBe('bob See you 1');
    events.next({
      event: 'MESSAGES_READ',
      data: { readerId: 'me', senderId: 'bob', readAt: '2026-10-31T10:05:00.000Z', messageIds: [] },
    });
    harness.detectChanges();
    expect(inbox(element)[0]).toBe('bob See you');
  });

  it('says when the other player is typing, and tells them when this player types', async () => {
    vi.useFakeTimers();
    const { harness, element } = await open('/messages/bob');
    events.next({ event: 'TYPING', data: { userId: 'carol' } });
    harness.detectChanges();
    expect(element.querySelector('.typing')).toBeNull();
    events.next({ event: 'TYPING', data: { userId: 'bob' } });
    harness.detectChanges();
    expect(element.querySelector('.typing')?.textContent).toContain('bob is typing');
    vi.advanceTimersByTime(4000);
    harness.detectChanges();
    expect(element.querySelector('.typing')).toBeNull();

    type(element, 'H');
    type(element, 'He');
    expect(typing).toHaveBeenCalledExactlyOnceWith('bob');
    vi.advanceTimersByTime(2000);
    type(element, 'Hel');
    expect(typing).toHaveBeenCalledTimes(2);
  });

  it('challenges the other player from the conversation', async () => {
    const { harness, element } = await open('/messages/bob');
    button(element, 'Challenge').click();
    expect(challenge).toHaveBeenCalledWith('bob');
    challenge.mockReturnValue(
      throwError(
        () =>
          new ApiError(
            new HttpErrorResponse({
              status: 403,
              error: {
                statusCode: 403,
                code: 'FRIENDS_ONLY',
                message: 'This player only lets friends challenge them.',
              },
            }),
          ),
      ),
    );
    button(element, 'Challenge').click();
    harness.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'only lets friends challenge them',
    );
  });

  it('blocks after confirmation, then offers to unblock instead of the message box', async () => {
    const { harness, element } = await open('/messages/bob');
    (element.querySelector('button[aria-label="Block bob"]') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(block).not.toHaveBeenCalled();
    expect(element.textContent).toContain('They are not told');
    button(element, 'Block bob').click();
    harness.detectChanges();
    expect(block).toHaveBeenCalledWith('bob');
    expect(element.querySelector('textarea')).toBeNull();
    expect(element.textContent).toContain('You blocked bob');
    button(element, 'Unblock').click();
    harness.detectChanges();
    expect(unblock).toHaveBeenCalledWith('bob');
    expect(element.querySelector('textarea')).not.toBeNull();
  });

  it('opens a conversation with a blocked player read-only', async () => {
    blocked.mockReturnValue(
      of({ users: [{ id: 'bob', username: 'bob', avatarUrl: null, blockedAt: '' }] }),
    );
    const { element } = await open('/messages/bob');
    expect(element.querySelector('textarea')).toBeNull();
    expect(button(element, 'Unblock')).toBeDefined();
    expect(button(element, 'Challenge')).toBeUndefined();
  });

  it('explains a message refused because the player blocked this one or wants friends only', async () => {
    const { harness, element } = await open('/messages/bob');
    type(element, 'Hello?');
    harness.detectChanges();
    button(element, 'Send').click();
    events.next({
      event: 'ERROR',
      data: {
        statusCode: 403,
        code: 'FRIENDS_ONLY',
        message: 'This player only lets friends send messages to them.',
      },
    });
    harness.detectChanges();
    expect(element.querySelector('.composer [role="alert"]')?.textContent).toContain(
      'only lets friends send messages to them. Your message was not sent.',
    );
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

  it('starts paging again when a reconnect leaves a hole in the conversation', async () => {
    const { harness, element } = await open('/messages/bob');
    expect(bubbles(element)).toEqual(['> Hi', '< See you']);
    // Three messages arrived while the socket was down; the newest page holds only two.
    const m3 = message('m3', 'bob', 'me', 'Three', 3);
    const m4 = message('m4', 'bob', 'me', 'Four', 4);
    const m5 = message('m5', 'bob', 'me', 'Five', 5);
    history.mockReturnValueOnce(of({ messages: [m5, m4], total: 5, limit: 2, offset: 0 }));
    state.set('reconnecting');
    harness.detectChanges();
    state.set('connected');
    harness.detectChanges();
    expect(bubbles(element)).toEqual(['< Four', '< Five']);

    history.mockReturnValueOnce(
      of({
        messages: [m3, message('m2', 'bob', 'me', 'See you', 2)],
        total: 5,
        limit: 2,
        offset: 2,
      }),
    );
    button(element, 'Load older messages').click();
    harness.detectChanges();
    expect(history).toHaveBeenLastCalledWith('bob', 2);
    history.mockReturnValueOnce(
      of({ messages: [message('m1', 'me', 'bob', 'Hi', 1)], total: 5, limit: 2, offset: 4 }),
    );
    button(element, 'Load older messages').click();
    harness.detectChanges();
    expect(history).toHaveBeenLastCalledWith('bob', 4);
    expect(bubbles(element)).toEqual(['> Hi', '< See you', '< Three', '< Four', '< Five']);
    expect(button(element, 'Load older messages')).toBeUndefined();
  });

  it('starts paging again when a live message overlaps the page reloaded after a reconnect', async () => {
    const { harness, element } = await open('/messages/bob');
    const reloaded = new Subject<unknown>();
    history.mockReturnValueOnce(reloaded);
    state.set('reconnecting');
    harness.detectChanges();
    state.set('connected');
    harness.detectChanges();
    // The newest message lands on the socket before the reload answers, and is also in its page.
    const m3 = message('m3', 'bob', 'me', 'Three', 3);
    const m4 = message('m4', 'bob', 'me', 'Four', 4);
    const m5 = message('m5', 'bob', 'me', 'Five', 5);
    events.next({ event: 'PRIVATE_MESSAGE', data: m5 });
    reloaded.next({ messages: [m5, m4], total: 5, limit: 2, offset: 0 });
    harness.detectChanges();
    expect(bubbles(element)).toEqual(['< Four', '< Five']);

    history.mockReturnValueOnce(
      of({
        messages: [m3, message('m2', 'bob', 'me', 'See you', 2)],
        total: 5,
        limit: 2,
        offset: 2,
      }),
    );
    button(element, 'Load older messages').click();
    harness.detectChanges();
    expect(history).toHaveBeenLastCalledWith('bob', 2);
    expect(bubbles(element)).toEqual(['< See you', '< Three', '< Four', '< Five']);
  });

  it('keeps a live message newer than the reloaded page, and counts it', async () => {
    const { harness, element } = await open('/messages/bob');
    const reloaded = new Subject<unknown>();
    history.mockReturnValueOnce(reloaded);
    state.set('reconnecting');
    harness.detectChanges();
    state.set('connected');
    harness.detectChanges();
    const m4 = message('m4', 'bob', 'me', 'Four', 4);
    const m5 = message('m5', 'bob', 'me', 'Five', 5);
    const m6 = message('m6', 'bob', 'me', 'Six', 6);
    events.next({ event: 'PRIVATE_MESSAGE', data: m6 });
    reloaded.next({ messages: [m5, m4], total: 5, limit: 2, offset: 0 });
    harness.detectChanges();
    expect(bubbles(element)).toEqual(['< Four', '< Five', '< Six']);
    history.mockReturnValueOnce(of({ messages: [], total: 6, limit: 2, offset: 3 }));
    button(element, 'Load older messages').click();
    expect(history).toHaveBeenLastCalledWith('bob', 3);
  });

  it('ignores an older page requested before the history restarted', async () => {
    const m1 = message('m1', 'me', 'bob', 'Hi', 1);
    const m2 = message('m2', 'bob', 'me', 'See you', 2);
    const m3 = message('m3', 'bob', 'me', 'Three', 3);
    history.mockReturnValueOnce(of({ messages: [m3, m2], total: 3, limit: 2, offset: 0 }));
    const { harness, element } = await open('/messages/bob');
    const older = new Subject<unknown>();
    history.mockReturnValueOnce(older);
    button(element, 'Load older messages').click();
    harness.detectChanges();
    const m5 = message('m5', 'bob', 'me', 'Five', 5);
    const m6 = message('m6', 'bob', 'me', 'Six', 6);
    history.mockReturnValueOnce(of({ messages: [m6, m5], total: 6, limit: 2, offset: 0 }));
    state.set('reconnecting');
    harness.detectChanges();
    state.set('connected');
    harness.detectChanges();
    older.next({ messages: [m1], total: 3, limit: 2, offset: 2 });
    harness.detectChanges();
    expect(bubbles(element)).toEqual(['< Five', '< Six']);
    history.mockReturnValueOnce(of({ messages: [], total: 6, limit: 2, offset: 2 }));
    button(element, 'Load older messages').click();
    expect(history).toHaveBeenLastCalledWith('bob', 2);
  });

  it('applies only the latest reload when two reconnects overlap', async () => {
    const { harness, element } = await open('/messages/bob');
    const first = new Subject<unknown>();
    const second = new Subject<unknown>();
    history.mockReturnValueOnce(first).mockReturnValueOnce(second);
    for (let round = 0; round < 2; round++) {
      state.set('reconnecting');
      harness.detectChanges();
      state.set('connected');
      harness.detectChanges();
    }
    const m5 = message('m5', 'bob', 'me', 'Five', 5);
    const m6 = message('m6', 'bob', 'me', 'Six', 6);
    second.next({ messages: [m6, m5], total: 6, limit: 2, offset: 0 });
    first.next({
      messages: [message('m4', 'bob', 'me', 'Four', 4), message('m3', 'bob', 'me', 'Three', 3)],
      total: 4,
      limit: 2,
      offset: 0,
    });
    harness.detectChanges();
    expect(bubbles(element)).toEqual(['< Five', '< Six']);
  });

  it('keeps a message pushed before the first page arrives', async () => {
    const first = new Subject<MessagePage>();
    history.mockReturnValueOnce(first);
    const { harness, element } = await open('/messages/bob');
    events.next({ event: 'PRIVATE_MESSAGE', data: message('m3', 'bob', 'me', 'Early', 3) });
    // The page was read before m3 was saved.
    first.next({
      messages: [message('m2', 'bob', 'me', 'See you', 2), message('m1', 'me', 'bob', 'Hi', 1)],
      total: 2,
      limit: 30,
      offset: 0,
    });
    first.complete();
    harness.detectChanges();
    expect(bubbles(element)).toEqual(['> Hi', '< See you', '< Early']);
    expect(button(element, 'Load older messages')).toBeUndefined();
  });

  it('drops an older page of the previous conversation after switching', async () => {
    history.mockReturnValueOnce(
      of({ messages: [message('m2', 'bob', 'me', 'See you', 2)], total: 2, limit: 30, offset: 0 }),
    );
    const { harness, element } = await open('/messages/bob');
    const older = new Subject<MessagePage>();
    history.mockReturnValueOnce(older);
    button(element, 'Load older messages').click();
    history.mockReturnValueOnce(
      of({ messages: [message('m8', 'dave', 'me', 'Yo', 8)], total: 2, limit: 30, offset: 0 }),
    );
    await harness.navigateByUrl('/messages/dave');
    harness.detectChanges();
    history.mockReturnValueOnce(
      of({ messages: [message('m2', 'bob', 'me', 'See you', 2)], total: 2, limit: 30, offset: 0 }),
    );
    await harness.navigateByUrl('/messages/bob');
    harness.detectChanges();
    older.next({ messages: [message('m1', 'me', 'bob', 'Hi', 1)], total: 2, limit: 30, offset: 1 });
    older.complete();
    harness.detectChanges();
    expect(bubbles(element)).not.toContain('> Hi');
    // The button is usable again for the conversation now shown.
    expect(button(element, 'Load older messages')?.disabled).toBe(false);
  });

  it('keeps the highest total when an older page was read before a live message', async () => {
    const m1 = message('m1', 'me', 'bob', 'Hi', 1);
    const m2 = message('m2', 'bob', 'me', 'See you', 2);
    const m3 = message('m3', 'bob', 'me', 'Three', 3);
    history.mockReturnValueOnce(of({ messages: [m3], total: 3, limit: 1, offset: 0 }));
    const { harness, element } = await open('/messages/bob');
    const older = new Subject<unknown>();
    history.mockReturnValueOnce(older);
    button(element, 'Load older messages').click();
    harness.detectChanges();
    events.next({ event: 'PRIVATE_MESSAGE', data: message('m4', 'bob', 'me', 'Four', 4) });
    older.next({ messages: [m2], total: 3, limit: 1, offset: 1 });
    harness.detectChanges();
    expect(bubbles(element)).toEqual(['< See you', '< Three', '< Four']);
    history.mockReturnValueOnce(of({ messages: [m1], total: 4, limit: 1, offset: 3 }));
    button(element, 'Load older messages').click();
    harness.detectChanges();
    expect(bubbles(element)).toEqual(['> Hi', '< See you', '< Three', '< Four']);
    expect(button(element, 'Load older messages')).toBeUndefined();
  });

  it('says so when the reload after a reconnect fails, and can try again', async () => {
    const { harness, element } = await open('/messages/bob');
    history.mockReturnValueOnce(throwError(() => new Error('down')));
    state.set('reconnecting');
    harness.detectChanges();
    state.set('connected');
    harness.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('may be missing');
    expect(bubbles(element)).toEqual(['> Hi', '< See you']);
    button(element, 'Try again').click();
    harness.detectChanges();
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('ignores answers for a conversation opened before, after coming back to it', async () => {
    const { harness, element } = await open('/messages/bob');
    const stale = new Subject<unknown>();
    history.mockReturnValueOnce(stale);
    state.set('reconnecting');
    harness.detectChanges();
    state.set('connected');
    harness.detectChanges();
    await harness.navigateByUrl('/messages/carol');
    await harness.navigateByUrl('/messages/bob');
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    stale.next({
      messages: [message('old', 'bob', 'me', 'Stale', 9)],
      total: 9,
      limit: 30,
      offset: 0,
    });
    harness.detectChanges();
    expect(bubbles(element)).not.toContain('< Stale');
  });

  it('accepts an address with an upper-case id and still shows live messages', async () => {
    const id = 'ABCDEF00-0000-4000-8000-000000000000';
    const { harness, element } = await open(`/messages/${id}`);
    events.next({
      event: 'PRIVATE_MESSAGE',
      data: message('m9', id.toLowerCase(), 'me', 'Live', 9),
    });
    harness.detectChanges();
    expect(bubbles(element)).toContain('< Live');
  });

  it('asks for the list again when a message arrives while it is loading', async () => {
    const { harness } = await open('/messages');
    const conversationsMock = TestBed.inject(MessagesApi).conversations as ReturnType<typeof vi.fn>;
    const slow = new Subject<unknown>();
    const fresh = new Subject<unknown>();
    conversationsMock.mockReturnValueOnce(slow).mockReturnValueOnce(fresh);
    const calls = conversationsMock.mock.calls.length;
    state.set('reconnecting');
    harness.detectChanges();
    state.set('connected');
    harness.detectChanges();
    events.next({ event: 'PRIVATE_MESSAGE', data: message('m8', 'bob', 'me', 'New', 8) });
    expect(conversationsMock.mock.calls.length).toBe(calls + 2);
  });

  it('keeps the place of a reader who scrolled up when a message arrives', async () => {
    const { harness, element } = await open('/messages/bob');
    const log = element.querySelector('[role="log"]') as HTMLElement;
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 200 });
    log.scrollTop = 100;
    events.next({ event: 'PRIVATE_MESSAGE', data: message('m7', 'bob', 'me', 'Seven', 7) });
    harness.detectChanges();
    await harness.fixture.whenStable();
    expect(log.scrollTop).toBe(100);
    log.scrollTop = 790;
    events.next({ event: 'PRIVATE_MESSAGE', data: message('m8', 'bob', 'me', 'Eight', 8) });
    harness.detectChanges();
    await harness.fixture.whenStable();
    expect(log.scrollTop).toBe(1000);
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
