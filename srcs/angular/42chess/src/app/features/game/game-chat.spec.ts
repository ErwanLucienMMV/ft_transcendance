import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import {
  ConnectionState,
  RealtimeService,
  ServerEvent,
} from '../../core/realtime/realtime.service';
import {
  GAME_CHAT_CONFIRM_MS,
  GameChat,
  GameChatApi,
  GameMessage,
  HIDE_SPECTATORS_KEY,
} from './game-chat';

function message(id: string, sender: string, content: string, minute: number): GameMessage {
  return {
    id,
    gameId: 'g1',
    sender: { id: sender, username: sender },
    content,
    createdAt: new Date(Date.UTC(2026, 10, 1, 12, minute)).toISOString(),
  };
}

@Component({
  imports: [GameChat],
  template: '<app-game-chat [gameId]="gameId()" [open]="open()" [players]="players()" />',
})
class Host {
  readonly gameId = signal('g1');
  readonly open = signal(true);
  readonly players = signal<string[]>([]);
}

describe('Game chat', () => {
  let history: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;
  let events: Subject<ServerEvent>;
  let state: ReturnType<typeof signal<ConnectionState>>;

  beforeEach(() => {
    history = vi.fn().mockReturnValue(
      of({
        messages: [message('m2', 'rival', 'Thanks', 2), message('m1', 'me', 'Good luck', 1)],
        total: 2,
        limit: 100,
        offset: 0,
      }),
    );
    send = vi.fn(() => true);
    events = new Subject();
    state = signal<ConnectionState>('connected');
    TestBed.configureTestingModule({
      providers: [
        { provide: GameChatApi, useValue: { history } },
        { provide: RealtimeService, useValue: { events: events.asObservable(), state, send } },
      ],
    });
    TestBed.inject(AuthSession).establish({
      user: { id: 'me', username: 'me', elo: 1000 },
      accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`,
    });
  });
  afterEach(() => {
    TestBed.inject(AuthSession).clear();
    vi.useRealTimers();
  });

  function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const lines = () =>
      [...element.querySelectorAll('li p')].map((line) => line.textContent?.trim());
    const box = () => element.querySelector('textarea') as HTMLTextAreaElement;
    const type = (text: string) => {
      box().value = text;
      box().dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const submit = () => {
      element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      fixture.detectChanges();
    };
    const button = () => element.querySelector('button[type="submit"]') as HTMLButtonElement;
    return { fixture, element, lines, box, type, submit, button };
  }
  const push = (data: GameMessage) =>
    events.next({ event: 'GAME_MESSAGE', data: data as unknown as Record<string, unknown> });

  it('shows the history oldest first, with who wrote each message', () => {
    const { element, lines } = setup();
    expect(history).toHaveBeenCalledWith('g1');
    expect(lines()).toEqual(['Good luck', 'Thanks']);
    expect(element.querySelector('li.mine strong')?.textContent?.trim()).toBe('me');
  });

  it('sends the draft, and clears it when the server confirms it', () => {
    const { fixture, box, type, submit, button, lines } = setup();
    expect(button().disabled).toBe(true);
    type('Nice move');
    submit();
    expect(send).toHaveBeenCalledWith('SEND_GAME_MESSAGE', { gameId: 'g1', content: 'Nice move' });
    expect(button().textContent).toContain('Sending');
    push(message('m3', 'me', 'Nice move', 3));
    fixture.detectChanges();
    expect(box().value).toBe('');
    expect(lines()).toEqual(['Good luck', 'Thanks', 'Nice move']);
  });

  it('sends with Enter and keeps Shift+Enter for a new line', () => {
    const { box, type } = setup();
    type('Hi');
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    expect(send).not.toHaveBeenCalled();
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('adds live messages once, and ignores those of another game', () => {
    const { fixture, lines } = setup();
    push(message('m3', 'rival', 'Check', 3));
    push(message('m3', 'rival', 'Check', 3));
    push({ ...message('m4', 'rival', 'Other game', 4), gameId: 'g2' });
    fixture.detectChanges();
    expect(lines()).toEqual(['Good luck', 'Thanks', 'Check']);
  });

  it('refuses blank and oversized text, counting an emoji as one character', () => {
    const { element, type, button, submit } = setup();
    type('   ');
    expect(button().disabled).toBe(true);
    type('👋'.repeat(2000));
    expect(button().disabled).toBe(false);
    type('x'.repeat(2001));
    expect(button().disabled).toBe(true);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('at most 2000');
    submit();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the draft when the socket is down or the server refuses', () => {
    const { fixture, element, box, type, submit } = setup();
    send.mockReturnValueOnce(false);
    type('Hello');
    submit();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('offline');
    expect(box().value).toBe('Hello');
    submit();
    events.next({ event: 'ERROR', data: { code: 'VALIDATION_ERROR', event: 'SEND_GAME_MESSAGE' } });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('not sent');
    expect(box().value).toBe('Hello');
    expect(box().readOnly).toBe(false);
  });

  it('does not take the error of another command for a refusal', () => {
    const { fixture, element, box, type, submit } = setup();
    type('Hello');
    submit();
    events.next({ event: 'ERROR', data: { code: 'ILLEGAL_MOVE' } });
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    push(message('m3', 'me', 'Hello', 3));
    fixture.detectChanges();
    expect(box().value).toBe('');
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  it('stops waiting for a confirmation that never comes, and reads the chat again', () => {
    vi.useFakeTimers();
    const { fixture, element, type, submit } = setup();
    type('Hello');
    submit();
    history.mockClear();
    vi.advanceTimersByTime(GAME_CHAT_CONFIRM_MS);
    fixture.detectChanges();
    expect(history).toHaveBeenCalledTimes(1);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('confirmed');
  });

  it('closes for writing when the game ends, and keeps the history', () => {
    const { fixture, element, lines } = setup();
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(element.querySelector('form')).toBeNull();
    expect(element.textContent).toContain('closed when the game ended');
    expect(lines()).toEqual(['Good luck', 'Thanks']);
  });

  it('reads the history again after a reconnect, without a hole', () => {
    const { fixture, lines } = setup();
    history.mockReturnValueOnce(
      of({
        messages: [message('m9', 'rival', 'Nine', 9), message('m8', 'rival', 'Eight', 8)],
        total: 9,
        limit: 2,
        offset: 0,
      }),
    );
    state.set('reconnecting');
    fixture.detectChanges();
    state.set('connected');
    fixture.detectChanges();
    // Nothing joins the new page to the old messages, so they are not kept around a gap.
    expect(lines()).toEqual(['Eight', 'Nine']);
    expect(fixture.nativeElement.textContent).toContain('Only the latest messages');
  });

  it('keeps a live message that overlaps a reload only as part of the page', () => {
    const { fixture, lines } = setup();
    const answer = new Subject<unknown>();
    history.mockReturnValueOnce(answer);
    state.set('reconnecting');
    fixture.detectChanges();
    state.set('connected');
    fixture.detectChanges();
    const m9 = message('m9', 'rival', 'Nine', 9);
    push(m9);
    answer.next({
      messages: [m9, message('m8', 'rival', 'Eight', 8)],
      total: 9,
      limit: 2,
      offset: 0,
    });
    fixture.detectChanges();
    expect(lines()).toEqual(['Eight', 'Nine']);
  });

  it('offers to retry when the history fails, and ignores an answer for another game', () => {
    history.mockReturnValueOnce(throwError(() => new Error('down')));
    const { fixture, element, lines } = setup();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
    (element.querySelector('.error button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(lines()).toEqual(['Good luck', 'Thanks']);
    const stale = new Subject<unknown>();
    history.mockReturnValueOnce(stale);
    fixture.componentInstance.gameId.set('g2');
    fixture.detectChanges();
    history.mockReturnValueOnce(of({ messages: [], total: 0, limit: 100, offset: 0 }));
    fixture.componentInstance.gameId.set('g3');
    fixture.detectChanges();
    stale.next({
      messages: [message('old', 'rival', 'Stale', 1)],
      total: 1,
      limit: 100,
      offset: 0,
    });
    fixture.detectChanges();
    expect(lines()).toEqual([]);
  });

  it('marks spectators and lets a player hide what they write', () => {
    localStorage.removeItem(HIDE_SPECTATORS_KEY);
    history.mockReturnValue(
      of({
        messages: [
          message('m3', 'fan', 'Go!', 3),
          message('m2', 'rival', 'Thanks', 2),
          message('m1', 'me', 'Good luck', 1),
        ],
        total: 3,
        limit: 100,
        offset: 0,
      }),
    );
    const { fixture, element, lines } = setup();
    // Seats not known yet: nobody is marked and nothing is offered.
    expect(element.querySelector('.tag')).toBeNull();
    expect(element.querySelector('.switch')).toBeNull();
    fixture.componentInstance.players.set(['me', 'rival']);
    fixture.detectChanges();
    expect(element.querySelector('li.spectator strong')?.textContent).toContain('fan');
    expect(element.querySelector('li.spectator .tag')?.textContent).toBe('spectator');

    const toggle = element.querySelector('.switch input') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(lines()).toEqual(['Good luck', 'Thanks']);
    expect(element.textContent).toContain('1 spectator message is hidden.');
    expect(localStorage.getItem(HIDE_SPECTATORS_KEY)).toBe('1');
    // A new spectator line stays hidden; a player's line shows.
    push(message('m4', 'fan', 'Wow', 4));
    push(message('m5', 'rival', 'Check', 5));
    fixture.detectChanges();
    expect(lines()).toEqual(['Good luck', 'Thanks', 'Check']);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(lines()).toEqual(['Good luck', 'Thanks', 'Go!', 'Wow', 'Check']);
    localStorage.removeItem(HIDE_SPECTATORS_KEY);
  });

  it('offers spectators no toggle', () => {
    const { fixture, element } = setup();
    fixture.componentInstance.players.set(['white', 'black']);
    fixture.detectChanges();
    expect(element.querySelector('.switch')).toBeNull();
  });
});
