import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { PresenceBadge } from '../../shared/presence-badge';
import { PresenceStatus, presenceChanges, UsersApi } from '../social/users-api';
import {
  Conversation,
  MESSAGE_MAX_LENGTH,
  messageLength,
  MessagesApi,
  PrivateMessage,
  privateMessages,
} from './messages-api';

/** How long a sent message may wait for its PRIVATE_MESSAGE before the page says so. */
export const SEND_CONFIRM_MS = 10_000;

export interface Peer {
  id: string;
  username: string;
  online: boolean;
}

/** Oldest first; ties keep the server's id order, so a page and a pushed copy agree. */
function chronological(a: PrivateMessage, b: PrivateMessage): number {
  return (
    Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function merge(list: PrivateMessage[], more: PrivateMessage[]): PrivateMessage[] {
  const byId = new Map(list.map((message) => [message.id, message]));
  for (const message of more) byId.set(message.id, message);
  return [...byId.values()].sort(chronological);
}

/**
 * Private messages: the conversation list, and the conversation with the player in the address.
 * History comes from HTTP; new messages, including the ones this account sends from another tab,
 * arrive on the signed-in socket.
 */
@Component({
  selector: 'app-messages-page',
  imports: [DatePipe, PresenceBadge, RouterLink],
  templateUrl: './messages-page.html',
  styleUrl: './messages-page.css',
})
export class MessagesPage {
  private readonly messages = inject(MessagesApi);
  private readonly users = inject(UsersApi);
  private readonly realtime = inject(RealtimeService);
  private readonly session = inject(AuthSession);
  readonly maxLength = MESSAGE_MAX_LENGTH;
  readonly me = computed(() => this.session.user()?.id ?? null);

  readonly peerId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('userId'))),
    { initialValue: null },
  );

  readonly conversations = signal<Conversation[] | null>(null);
  readonly listFailed = signal(false);
  /** Conversations opened on this page; there is no read receipt API to tell the server. */
  private readonly seen = signal<ReadonlySet<string>>(new Set());

  readonly peer = signal<Peer | null>(null);
  readonly peerError = signal<string | null>(null);
  private readonly pushed = signal<PresenceStatus | null>(null);
  readonly status = computed<PresenceStatus>(
    () => this.pushed() ?? (this.peer()?.online ? 'ONLINE' : 'OFFLINE'),
  );

  readonly thread = signal<PrivateMessage[] | null>(null);
  readonly total = signal(0);
  readonly threadFailed = signal(false);
  readonly loadingOlder = signal(false);
  readonly hasOlder = computed(() => (this.thread()?.length ?? 0) < this.total());

  readonly draft = signal('');
  readonly length = computed(() => messageLength(this.draft()));
  readonly tooLong = computed(() => this.length() > MESSAGE_MAX_LENGTH);
  readonly blank = computed(() => this.draft().trim() === '');
  /** The text sent and not confirmed yet; one message at a time. */
  readonly pending = signal<string | null>(null);
  readonly sendError = signal<string | null>(null);
  private confirmTimer?: ReturnType<typeof setTimeout>;
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');

  constructor() {
    effect(() => {
      if (!this.me()) return;
      untracked(() => this.loadConversations());
    });
    effect(() => {
      const id = this.peerId();
      untracked(() => this.open(id));
    });
    // Delivery is best effort and a reconnect replays nothing: read history again.
    let previous = this.realtime.state();
    effect(() => {
      const state = this.realtime.state();
      const reconnected = state === 'connected' && previous !== 'connected';
      previous = state;
      if (!reconnected) return;
      untracked(() => {
        if (this.conversations()) this.loadConversations();
        const id = this.peerId();
        if (id && this.thread()) this.loadNewest(id);
      });
    });
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => clearTimeout(this.confirmTimer));
    privateMessages(this.realtime)
      .pipe(takeUntilDestroyed(destroy))
      .subscribe((message) => this.receive(message));
    presenceChanges(this.realtime)
      .pipe(takeUntilDestroyed(destroy))
      .subscribe(({ userId, status }) => {
        if (userId === this.peerId()) this.pushed.set(status);
      });
    this.realtime.events
      .pipe(
        filter(({ event }) => event === 'ERROR' && this.pending() !== null),
        takeUntilDestroyed(destroy),
      )
      .subscribe(({ data }) => this.failed(typeof data['code'] === 'string' ? data['code'] : ''));
  }

  unread(conversation: Conversation): number {
    return this.seen().has(conversation.user.id) ? 0 : conversation.unreadCount;
  }

  mine(message: PrivateMessage): boolean {
    return message.senderId === this.me();
  }

  loadConversations(): void {
    this.listFailed.set(false);
    this.messages.conversations().subscribe({
      next: ({ conversations }) => this.conversations.set(conversations),
      error: () => this.listFailed.set(true),
    });
  }

  loadOlder(): void {
    const id = this.peerId();
    const loaded = this.thread();
    if (!id || !loaded || this.loadingOlder()) return;
    this.loadingOlder.set(true);
    this.messages.history(id, loaded.length).subscribe({
      next: (page) => {
        this.loadingOlder.set(false);
        if (id !== this.peerId()) return;
        this.thread.update((list) => merge(list ?? [], page.messages));
        this.total.set(page.total);
      },
      error: () => this.loadingOlder.set(false),
    });
  }

  retry(): void {
    this.open(this.peerId());
  }

  input(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
    this.sendError.set(null);
  }

  /** Enter sends; Shift+Enter starts a new line. */
  keydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.send();
  }

  send(): void {
    const id = this.peerId();
    const content = this.draft();
    if (!id || !this.peer() || this.pending() !== null || this.blank() || this.tooLong()) return;
    this.sendError.set(null);
    if (!this.messages.send(id, content)) {
      this.sendError.set('You are offline. Your message was not sent; try again in a moment.');
      return;
    }
    this.pending.set(content);
    clearTimeout(this.confirmTimer);
    this.confirmTimer = setTimeout(() => {
      if (this.pending() === null) return;
      this.pending.set(null);
      this.sendError.set('Your message could not be confirmed. Check the conversation below.');
      this.loadNewest(id);
    }, SEND_CONFIRM_MS);
  }

  private open(id: string | null): void {
    clearTimeout(this.confirmTimer);
    this.pending.set(null);
    this.sendError.set(null);
    this.draft.set('');
    this.peer.set(null);
    this.peerError.set(null);
    this.pushed.set(null);
    this.thread.set(null);
    this.total.set(0);
    this.threadFailed.set(false);
    if (!id) return;
    if (id === this.me()) {
      this.peerError.set('You cannot send messages to yourself.');
      return;
    }
    this.seen.update((ids) => new Set(ids).add(id));
    this.users.profile(id).subscribe({
      next: (profile) => {
        if (id !== this.peerId()) return;
        this.peer.set({ id: profile.id, username: profile.username, online: profile.online });
        this.loadNewest(id);
      },
      error: (error: unknown) => {
        if (id !== this.peerId()) return;
        this.peerError.set(
          error instanceof ApiError && error.statusCode === 404
            ? 'This player does not exist.'
            : 'This conversation could not be opened.',
        );
      },
    });
  }

  private loadNewest(id: string): void {
    this.threadFailed.set(false);
    this.messages.history(id).subscribe({
      next: (page) => {
        if (id !== this.peerId()) return;
        const list = this.thread() ?? [];
        const ids = new Set(page.messages.map((message) => message.id));
        const joined =
          page.messages.length >= page.total || list.some((message) => ids.has(message.id));
        if (joined) {
          this.thread.set(merge(list, page.messages));
          this.total.set(page.total);
        } else {
          // More messages arrived than one page holds (say, during a disconnection): what is
          // shown would have a hole, and offsets count from the newest. Start again from this
          // page, keeping only what the socket delivered after it.
          const newest = page.messages.reduce<PrivateMessage | null>(
            (latest, message) => (!latest || chronological(message, latest) > 0 ? message : latest),
            null,
          );
          const later = newest ? list.filter((message) => chronological(message, newest) > 0) : [];
          this.thread.set(merge(page.messages, later));
          this.total.set(page.total + later.length);
        }
        this.scrollToEnd();
      },
      error: () => {
        if (id === this.peerId() && !this.thread()) this.threadFailed.set(true);
      },
    });
  }

  private receive(message: PrivateMessage): void {
    const me = this.me();
    if (!me) return;
    const peerId = message.senderId === me ? message.receiverId : message.senderId;
    const open = peerId === this.peerId();
    const list = this.conversations();
    const known = list?.find((conversation) => conversation.user.id === peerId);
    if (known && list) {
      const incoming = message.senderId !== me;
      const updated: Conversation = {
        ...known,
        lastMessage: message,
        unreadCount: known.unreadCount + (incoming && !open ? 1 : 0),
      };
      if (incoming && !open)
        this.seen.update((ids) => {
          const next = new Set(ids);
          next.delete(peerId);
          return next;
        });
      this.conversations.set([updated, ...list.filter((item) => item !== known)]);
    } else if (list) {
      this.loadConversations();
    }
    if (open && this.thread()) {
      const before = this.thread()!.length;
      this.thread.update((thread) => merge(thread ?? [], [message]));
      if (this.thread()!.length > before) this.total.update((total) => total + 1);
      this.scrollToEnd();
    }
    if (message.senderId === me && open && this.pending() === message.content) {
      clearTimeout(this.confirmTimer);
      this.pending.set(null);
      this.draft.set('');
    }
  }

  private failed(code: string): void {
    clearTimeout(this.confirmTimer);
    this.pending.set(null);
    this.sendError.set(
      code === 'USER_NOT_FOUND'
        ? 'This player no longer exists. Your message was not sent.'
        : code === 'VALIDATION_ERROR'
          ? 'This message cannot be sent. Check its length and content.'
          : 'Your message was not sent. Try again.',
    );
  }

  private scrollToEnd(): void {
    setTimeout(() => {
      const log = this.log()?.nativeElement;
      if (log) log.scrollTop = log.scrollHeight;
    });
  }
}
