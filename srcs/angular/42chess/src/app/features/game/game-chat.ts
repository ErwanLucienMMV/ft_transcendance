import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injectable,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { AuthSession } from '../../core/auth/auth-session';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { MESSAGE_MAX_LENGTH, messageLength } from '../chat/messages-api';
import { tr, trCount } from '../../core/i18n/i18n';
import { TranslocoDirective } from '@jsverse/transloco';
import { LocalDatePipe } from '../../shared/ui/local-date';

/** Spec §21: the body of GAME_MESSAGE and of the history. */
export interface GameMessage {
  id: string;
  gameId: string;
  sender: { id: string; username: string };
  content: string;
  createdAt: string;
}
export interface GameMessagePage {
  messages: GameMessage[];
  total: number;
  limit: number;
  offset: number;
}

/** The newest messages are enough to follow a game, and the API returns 100 at most. */
export const GAME_CHAT_HISTORY = 100;
/** How long a sent message may wait for its GAME_MESSAGE before the chat says so. */
export const GAME_CHAT_CONFIRM_MS = 10_000;
/** Remembered in this browser: a player who hid spectators keeps them hidden. */
export const HIDE_SPECTATORS_KEY = '42chess.chat.hideSpectators';

function remembered(): boolean {
  try {
    return globalThis.localStorage?.getItem(HIDE_SPECTATORS_KEY) === '1';
  } catch {
    return false;
  }
}
const FOLLOW_MARGIN_PX = 48;

function chronological(a: GameMessage, b: GameMessage): number {
  return (
    Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function merge(list: GameMessage[], more: GameMessage[]): GameMessage[] {
  const byId = new Map(list.map((message) => [message.id, message]));
  for (const message of more) byId.set(message.id, message);
  return [...byId.values()].sort(chronological);
}

function isGameMessage(data: Record<string, unknown>): boolean {
  const sender = data['sender'] as Record<string, unknown> | null | undefined;
  return (
    ['id', 'gameId', 'content', 'createdAt'].every((key) => typeof data[key] === 'string') &&
    typeof sender?.['id'] === 'string' &&
    typeof sender?.['username'] === 'string'
  );
}

@Injectable({ providedIn: 'root' })
export class GameChatApi {
  private readonly api = inject(ApiClient);

  /** Newest first. */
  history(gameId: string, limit = GAME_CHAT_HISTORY): Observable<GameMessagePage> {
    return this.api.get(`games/${encodeURIComponent(gameId)}/messages`, {
      params: { limit, offset: 0 },
    });
  }
}

/**
 * Chat of one game, for its players and spectators. History comes from HTTP and new messages
 * from the game's room; the chat closes for writing when the game ends.
 */
@Component({
  selector: 'app-game-chat',
  imports: [LocalDatePipe, TranslocoDirective],
  templateUrl: './game-chat.html',
  styleUrl: './game-chat.css',
})
export class GameChat {
  private readonly api = inject(GameChatApi);
  private readonly realtime = inject(RealtimeService);
  private readonly session = inject(AuthSession);
  private readonly injector = inject(Injector);
  readonly gameId = input.required<string>();
  /** False once the game is over: the history stays, and nothing can be sent. */
  readonly open = input(true);
  /** The seated players' ids; every other author is a spectator. */
  readonly players = input<readonly string[]>([]);
  /** Players can hide what spectators write, to play without comments. */
  readonly hideSpectators = signal(remembered());
  private readonly seated = computed(() => new Set(this.players().filter(Boolean)));
  readonly visible = computed(() =>
    this.hideSpectators() && this.seated().size
      ? this.messages().filter((message) => this.seated().has(message.sender.id))
      : this.messages(),
  );
  readonly hidden = computed(() => this.messages().length - this.visible().length);
  readonly maxLength = MESSAGE_MAX_LENGTH;

  readonly messages = signal<GameMessage[]>([]);
  readonly total = signal(0);
  readonly loaded = signal(false);
  readonly loadFailed = signal(false);
  readonly draft = signal('');
  readonly pending = signal<string | null>(null);
  readonly sendError = signal<string | null>(null);
  readonly length = computed(() => messageLength(this.draft()));
  readonly tooLong = computed(() => this.length() > MESSAGE_MAX_LENGTH);
  readonly blank = computed(() => this.draft().trim() === '');
  readonly truncated = computed(() => this.total() > this.messages().length);
  private readonly me = computed(() => this.session.user()?.id ?? null);
  /** The toggle is offered to the players, who are the ones it helps. */
  readonly seatedViewer = computed(() => {
    const me = this.me();
    return Boolean(me) && this.seated().has(me!);
  });
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private request = 0;
  private confirmTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const id = this.gameId();
      untracked(() => this.reset(id));
    });
    // A reconnect replays nothing: read the history again.
    let previous = this.realtime.state();
    effect(() => {
      const state = this.realtime.state();
      const reconnected = state === 'connected' && previous !== 'connected';
      previous = state;
      if (reconnected) untracked(() => this.load(this.gameId()));
    });
    // Ended while a message was on its way: the server refuses it, and the draft stays readable.
    effect(() => {
      if (!this.open() && untracked(this.pending) !== null) untracked(() => this.settle());
    });
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => clearTimeout(this.confirmTimer));
    this.realtime.events
      .pipe(
        filter(({ event, data }) => event === 'GAME_MESSAGE' && isGameMessage(data)),
        takeUntilDestroyed(destroy),
      )
      .subscribe(({ data }) => this.receive(data as unknown as GameMessage));
    this.realtime.events
      .pipe(
        filter(
          ({ event, data }) =>
            event === 'ERROR' && data['event'] === 'SEND_GAME_MESSAGE' && this.pending() !== null,
        ),
        takeUntilDestroyed(destroy),
      )
      .subscribe(() => {
        this.settle();
        this.sendError.set(tr('game.chat.notSent'));
      });
  }

  hiddenText(count: number): string {
    return trCount('game.chat.hidden', count);
  }

  mine(message: GameMessage): boolean {
    return message.sender.id === this.me();
  }

  /** Known only once the seats are: until then nobody is marked. */
  spectator(message: GameMessage): boolean {
    return this.seated().size > 0 && !this.seated().has(message.sender.id);
  }

  toggleSpectators(event: Event): void {
    const hide = (event.target as HTMLInputElement).checked;
    this.hideSpectators.set(hide);
    try {
      globalThis.localStorage?.setItem(HIDE_SPECTATORS_KEY, hide ? '1' : '0');
    } catch {
      // Private browsing: the choice lasts for this page only.
    }
  }

  input(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
    this.sendError.set(null);
  }

  keydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.send();
  }

  send(): void {
    const content = this.draft();
    if (!this.open() || this.pending() !== null || this.blank() || this.tooLong()) return;
    this.sendError.set(null);
    if (!this.realtime.send('SEND_GAME_MESSAGE', { gameId: this.gameId(), content })) {
      this.sendError.set(tr('game.chat.offline'));
      return;
    }
    this.pending.set(content);
    clearTimeout(this.confirmTimer);
    this.confirmTimer = setTimeout(() => {
      this.settle();
      this.sendError.set(tr('game.chat.unconfirmed'));
      this.load(this.gameId());
    }, GAME_CHAT_CONFIRM_MS);
  }

  retry(): void {
    this.load(this.gameId());
  }

  private reset(id: string): void {
    this.settle();
    this.messages.set([]);
    this.total.set(0);
    this.loaded.set(false);
    this.draft.set('');
    this.sendError.set(null);
    this.load(id);
  }

  private settle(): void {
    clearTimeout(this.confirmTimer);
    this.pending.set(null);
  }

  private load(id: string): void {
    const request = ++this.request;
    this.loadFailed.set(false);
    this.api.history(id).subscribe({
      next: (page) => {
        if (request !== this.request || id !== this.gameId()) return;
        const follow = this.following();
        const list = this.messages();
        const ordered = [...page.messages].sort(chronological);
        const newest = ordered.at(-1);
        // Delivered on the socket after this page was read.
        const later = newest ? list.filter((message) => chronological(message, newest) > 0) : [];
        // Only the page's oldest message proves there is no hole between it and what is shown.
        const joined =
          page.messages.length >= page.total ||
          list.some((message) => message.id === ordered[0]?.id);
        this.messages.set(joined ? merge(list, page.messages) : merge(page.messages, later));
        this.total.set(page.total + later.length);
        this.loaded.set(true);
        if (follow) this.scrollToEnd();
      },
      error: () => {
        if (request === this.request && id === this.gameId()) this.loadFailed.set(true);
      },
    });
  }

  private receive(message: GameMessage): void {
    if (message.gameId !== this.gameId()) return;
    const mine = this.mine(message);
    const follow = mine || this.following();
    const before = this.messages().length;
    this.messages.update((list) => merge(list, [message]));
    if (this.messages().length > before) this.total.update((total) => total + 1);
    if (follow) this.scrollToEnd();
    if (mine && this.pending() === message.content) {
      this.settle();
      this.draft.set('');
    }
  }

  private following(): boolean {
    const log = this.log()?.nativeElement;
    return !log || log.scrollHeight - log.scrollTop - log.clientHeight <= FOLLOW_MARGIN_PX;
  }

  private scrollToEnd(): void {
    afterNextRender(
      () => {
        const log = this.log()?.nativeElement;
        if (log) log.scrollTop = log.scrollHeight;
      },
      { injector: this.injector },
    );
  }
}
