import { DatePipe, DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { errorText } from '../../core/api/error-text';
import { AuthSession } from '../../core/auth/auth-session';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { PresenceBadge } from '../../shared/presence-badge';
import { UserAvatar } from '../../shared/user-avatar';
import { Challenges } from '../social/challenge';
import { PresenceStatus, presenceChanges, UsersApi } from '../social/users-api';
import {
  challengedGame,
  Conversation,
  MESSAGE_MAX_LENGTH,
  messageLength,
  MessagesApi,
  PrivateMessage,
  privateMessages,
  ReadReceipt,
  readReceipts,
  TYPING_INTERVAL_MS,
  TYPING_SHOWN_MS,
  typingHints,
} from './messages-api';
import { Spinner } from '../../shared/ui/spinner';
import { UnreadMessages } from '../../core/notifications/unread-messages';

/** Closer to the end of the log than this counts as following the conversation. */
const FOLLOW_MARGIN_PX = 48;

/** How long a sent message may wait for its PRIVATE_MESSAGE before the page says so. */
export const SEND_CONFIRM_MS = 10_000;

export interface Peer {
  id: string;
  username: string;
  avatarUrl?: string | null;
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
  imports: [Spinner, DatePipe, PresenceBadge, RouterLink, UserAvatar],
  templateUrl: './messages-page.html',
  styleUrl: './messages-page.css',
})
export class MessagesPage {
  private readonly messages = inject(MessagesApi);
  private readonly unreadMessages = inject(UnreadMessages);
  private readonly users = inject(UsersApi);
  private readonly realtime = inject(RealtimeService);
  private readonly session = inject(AuthSession);
  private readonly challenges = inject(Challenges);
  private readonly document = inject(DOCUMENT);
  private readonly origin = this.document.location.origin;
  private readonly injector = inject(Injector);
  readonly maxLength = MESSAGE_MAX_LENGTH;
  readonly me = computed(() => this.session.user()?.id ?? null);

  readonly peerId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(
      map((params) => params.get('userId')?.toLowerCase() ?? null),
    ),
    { initialValue: null },
  );

  readonly conversations = signal<Conversation[] | null>(null);
  readonly listFailed = signal(false);
  private listRequest = 0;
  private listLoading = false;
  /** The conversation being marked read, so a burst of messages sends one request. */
  private marking: string | null = null;
  private markAgain = false;

  readonly peer = signal<Peer | null>(null);
  readonly peerError = signal<string | null>(null);
  private readonly pushed = signal<PresenceStatus | null>(null);
  readonly status = computed<PresenceStatus>(
    () => this.pushed() ?? (this.peer()?.online ? 'ONLINE' : 'OFFLINE'),
  );
  /** Whether the visitor blocked this player; null until known. */
  readonly blocked = signal<boolean | null>(null);
  readonly confirmingBlock = signal(false);
  readonly peerBusy = signal(false);
  readonly peerActionError = signal<string | null>(null);
  readonly challenging = signal(false);
  readonly peerTyping = signal(false);
  private typingTimer?: ReturnType<typeof setTimeout>;
  private typingSent = 0;

  readonly thread = signal<PrivateMessage[] | null>(null);
  readonly total = signal(0);
  private newestRequest = 0;
  private historyStart = 0;
  /** Messages pushed for the open conversation before its first page arrived. */
  private early: PrivateMessage[] = [];
  readonly threadFailed = signal(false);
  /** The reload after a reconnect failed, so messages may be missing from what is shown. */
  readonly refreshFailed = signal(false);
  readonly loadingOlder = signal(false);
  readonly hasOlder = computed(() => (this.thread()?.length ?? 0) < this.total());
  /** "Read" or "Sent" under the last message this account sent, when it is the latest. */
  readonly receipt = computed<{ id: string; readAt: string | null } | null>(() => {
    const last = this.thread()?.at(-1);
    if (!last || last.senderId !== this.me()) return null;
    return { id: last.id, readAt: last.readAt ?? null };
  });

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
    destroy.onDestroy(() => {
      clearTimeout(this.confirmTimer);
      clearTimeout(this.typingTimer);
    });
    privateMessages(this.realtime)
      .pipe(takeUntilDestroyed(destroy))
      .subscribe((message) => this.receive(message));
    presenceChanges(this.realtime)
      .pipe(takeUntilDestroyed(destroy))
      .subscribe(({ userId, status }) => {
        if (userId === this.peerId()) this.pushed.set(status);
      });
    readReceipts(this.realtime)
      .pipe(takeUntilDestroyed(destroy))
      .subscribe((receipt) => this.read(receipt));
    typingHints(this.realtime)
      .pipe(takeUntilDestroyed(destroy))
      .subscribe((userId) => {
        if (userId !== this.peerId()) return;
        this.peerTyping.set(true);
        clearTimeout(this.typingTimer);
        this.typingTimer = setTimeout(() => this.peerTyping.set(false), TYPING_SHOWN_MS);
      });
    this.realtime.events
      .pipe(
        filter(({ event }) => event === 'ERROR' && this.pending() !== null),
        takeUntilDestroyed(destroy),
      )
      .subscribe(({ data }) =>
        this.failed(
          typeof data['code'] === 'string' ? data['code'] : '',
          typeof data['message'] === 'string' ? data['message'] : '',
        ),
      );
    // Coming back to the tab reads what arrived while it was hidden.
    const visible = () => {
      const id = this.peerId();
      if (this.document.visibilityState === 'visible' && id && this.thread()) this.markRead(id);
    };
    this.document.addEventListener('visibilitychange', visible);
    destroy.onDestroy(() => this.document.removeEventListener('visibilitychange', visible));
  }

  unread(conversation: Conversation): number {
    return conversation.unreadCount;
  }

  challengePeer(): void {
    const id = this.peerId();
    if (!id || this.challenging()) return;
    this.challenging.set(true);
    this.peerActionError.set(null);
    this.challenges.send(id).subscribe({
      error: (error: unknown) => {
        this.challenging.set(false);
        this.peerActionError.set(
          errorText(error, 'The challenge could not be sent. Check your connection and try again.'),
        );
      },
      complete: () => this.challenging.set(false),
    });
  }

  block(): void {
    const id = this.peerId();
    if (!id || this.peerBusy()) return;
    this.peerBusy.set(true);
    this.peerActionError.set(null);
    this.users.block(id).subscribe({
      next: () => {
        this.peerBusy.set(false);
        this.confirmingBlock.set(false);
        this.blocked.set(true);
        this.peerTyping.set(false);
      },
      error: (error: unknown) => {
        this.peerBusy.set(false);
        this.peerActionError.set(errorText(error, 'This player could not be blocked. Try again.'));
      },
    });
  }

  unblock(): void {
    const id = this.peerId();
    if (!id || this.peerBusy()) return;
    this.peerBusy.set(true);
    this.peerActionError.set(null);
    this.users.unblock(id).subscribe({
      next: () => {
        this.peerBusy.set(false);
        this.blocked.set(false);
      },
      error: (error: unknown) => {
        this.peerBusy.set(false);
        this.peerActionError.set(
          errorText(error, 'This player could not be unblocked. Try again.'),
        );
      },
    });
  }

  /** The game to join when this message is a challenge. */
  challenge(message: PrivateMessage): string | null {
    return challengedGame(message.content, this.origin);
  }

  mine(message: PrivateMessage): boolean {
    return message.senderId === this.me();
  }

  loadConversations(): void {
    const request = ++this.listRequest;
    this.listLoading = true;
    this.listFailed.set(false);
    this.messages.conversations().subscribe({
      next: ({ conversations }) => {
        if (request !== this.listRequest) return;
        this.listLoading = false;
        this.conversations.set(conversations);
      },
      error: () => {
        if (request !== this.listRequest) return;
        this.listLoading = false;
        this.listFailed.set(true);
      },
    });
  }

  loadOlder(): void {
    const id = this.peerId();
    const loaded = this.thread();
    if (!id || !loaded || this.loadingOlder()) return;
    this.loadingOlder.set(true);
    const start = this.historyStart;
    this.messages.history(id, loaded.length).subscribe({
      next: (page) => {
        if (start !== this.historyStart) return;
        this.loadingOlder.set(false);
        if (id !== this.peerId()) return;
        const log = this.log()?.nativeElement;
        const fromEnd = log ? log.scrollHeight - log.scrollTop : 0;
        this.thread.update((list) => merge(list ?? [], page.messages));
        // A message pushed while this page was on its way is not in its total.
        this.total.update((total) => Math.max(total, page.total));
        // Keep the messages being read in place while older ones appear above them.
        this.afterRender((element) => (element.scrollTop = element.scrollHeight - fromEnd));
      },
      error: () => {
        if (start === this.historyStart) this.loadingOlder.set(false);
      },
    });
  }

  retry(): void {
    this.open(this.peerId());
  }

  input(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
    this.sendError.set(null);
    const id = this.peerId();
    const now = Date.now();
    if (id && !this.blank() && !this.blocked() && now - this.typingSent >= TYPING_INTERVAL_MS) {
      this.typingSent = now;
      this.messages.typing(id);
    }
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
    this.blocked.set(null);
    this.confirmingBlock.set(false);
    this.peerActionError.set(null);
    this.peerTyping.set(false);
    clearTimeout(this.typingTimer);
    this.typingSent = 0;
    this.thread.set(null);
    this.total.set(0);
    this.threadFailed.set(false);
    this.refreshFailed.set(false);
    // Answers still on their way belong to the conversation shown before, even if the player
    // comes back to it.
    this.historyStart++;
    this.newestRequest++;
    this.loadingOlder.set(false);
    this.early = [];
    if (!id) return;
    if (id === this.me()) {
      this.peerError.set('You cannot send messages to yourself.');
      return;
    }
    this.users.blocked().subscribe({
      next: ({ users }) => {
        if (id === this.peerId()) this.blocked.set(users.some((user) => user.id === id));
      },
      // Unknown: the conversation stays usable, and the server refuses what is not allowed.
      error: () => {
        if (id === this.peerId()) this.blocked.set(false);
      },
    });
    this.users.profile(id).subscribe({
      next: (profile) => {
        if (id !== this.peerId()) return;
        this.peer.set({
          id: profile.id,
          username: profile.username,
          avatarUrl: profile.avatarUrl,
          online: profile.online,
        });
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

  reload(): void {
    const id = this.peerId();
    if (id) this.loadNewest(id);
  }

  private loadNewest(id: string): void {
    const request = ++this.newestRequest;
    this.threadFailed.set(false);
    this.refreshFailed.set(false);
    this.messages.history(id).subscribe({
      next: (page) => {
        if (id !== this.peerId() || request !== this.newestRequest) return;
        const follow = this.following();
        // Before the first page, live messages wait in `early`: the page may have been read
        // before they were saved.
        const list = this.thread() ?? this.early;
        this.early = [];
        const ordered = [...page.messages].sort(chronological);
        const newest = ordered.at(-1);
        // What the socket delivered after this page was read; its messages are not in the page.
        const later = newest ? list.filter((message) => chronological(message, newest) > 0) : [];
        // The page continues what is shown only if its oldest message is already there. Any
        // other shared message could be a live one, with a hole just before it.
        const joined =
          page.messages.length >= page.total ||
          list.some((message) => message.id === ordered[0]?.id);
        if (joined) {
          this.thread.set(merge(list, page.messages));
        } else {
          // Offsets count from the newest, so a hole would make older pages unreachable. Start
          // again from this page; any older page still on its way used the previous offsets.
          this.historyStart++;
          this.loadingOlder.set(false);
          this.thread.set(merge(page.messages, later));
        }
        this.total.set(page.total + later.length);
        if (follow) this.scrollToEnd();
        this.markRead(id);
      },
      error: () => {
        if (id !== this.peerId() || request !== this.newestRequest) return;
        if (this.thread()) this.refreshFailed.set(true);
        else this.threadFailed.set(true);
      },
    });
  }

  private receive(message: PrivateMessage): void {
    const me = this.me();
    if (!me) return;
    // The answer on its way may have been read before this message: ask again.
    if (this.listLoading) this.loadConversations();
    const peerId = message.senderId === me ? message.receiverId : message.senderId;
    const open = peerId === this.peerId();
    const list = this.conversations();
    const known = list?.find((conversation) => conversation.user.id === peerId);
    const incoming = message.senderId !== me;
    if (known && list) {
      const updated: Conversation = {
        ...known,
        lastMessage: message,
        // An open, visible conversation is read at once.
        unreadCount:
          known.unreadCount +
          (incoming && !(open && this.document.visibilityState !== 'hidden') ? 1 : 0),
      };
      this.conversations.set([updated, ...list.filter((item) => item !== known)]);
    } else if (list) {
      this.loadConversations();
    }
    if (open && !this.thread()) this.early = merge(this.early, [message]);
    if (open && this.thread()) {
      const follow = message.senderId === me || this.following();
      const before = this.thread()!.length;
      this.thread.update((thread) => merge(thread ?? [], [message]));
      if (this.thread()!.length > before) this.total.update((total) => total + 1);
      if (follow) this.scrollToEnd();
      if (incoming) {
        this.peerTyping.set(false);
        this.markRead(peerId);
      }
    }
    if (message.senderId === me && open && this.pending() === message.content) {
      clearTimeout(this.confirmTimer);
      this.pending.set(null);
      this.draft.set('');
    }
  }

  private failed(code: string, message: string): void {
    clearTimeout(this.confirmTimer);
    this.pending.set(null);
    this.sendError.set(
      code === 'USER_NOT_FOUND'
        ? 'This player no longer exists. Your message was not sent.'
        : code === 'VALIDATION_ERROR'
          ? 'This message cannot be sent. Check its length and content.'
          : (code === 'USER_BLOCKED' || code === 'FRIENDS_ONLY') && message
            ? `${message} Your message was not sent.`
            : 'Your message was not sent. Try again.',
    );
  }

  /**
   * Tells the server this conversation is read, when it is open, visible and has unread
   * messages. MESSAGES_READ then updates every tab, and the sender's.
   */
  private markRead(id: string): void {
    if (id !== this.peerId()) return;
    if (this.document.visibilityState === 'hidden') return;
    if (this.marking === id) {
      // A message arrived while the last request was on its way: mark again after it.
      this.markAgain = true;
      return;
    }
    const unreadListed =
      this.conversations()?.find((conversation) => conversation.user.id === id)?.unreadCount ?? 0;
    const unreadShown = (this.thread() ?? []).some(
      (message) => message.senderId === id && !message.readAt,
    );
    if (!unreadListed && !unreadShown) return;
    this.marking = id;
    this.markAgain = false;
    this.messages.markRead(id).subscribe({
      next: () => {
        this.marking = null;
        this.clearUnread(id);
        if (this.markAgain) {
          this.markAgain = false;
          this.markRead(id);
        }
      },
      // Unread stays unread; the next message or visit tries again.
      error: () => {
        this.marking = null;
        this.markAgain = false;
      },
    });
  }

  private clearUnread(peerId: string): void {
    // The header badge too, without waiting for MESSAGES_READ.
    this.unreadMessages.clear(peerId);
    this.conversations.update(
      (list) =>
        list?.map((conversation) =>
          conversation.user.id === peerId ? { ...conversation, unreadCount: 0 } : conversation,
        ) ?? null,
    );
  }

  private read(receipt: ReadReceipt): void {
    const me = this.me();
    if (!me) return;
    const ids = new Set(receipt.messageIds);
    if (receipt.readerId === me) this.clearUnread(receipt.senderId);
    const peerId = receipt.readerId === me ? receipt.senderId : receipt.readerId;
    if (peerId !== this.peerId() || (receipt.readerId !== me && receipt.senderId !== me)) return;
    this.thread.update(
      (list) =>
        list?.map((message) =>
          ids.has(message.id) && !message.readAt ? { ...message, readAt: receipt.readAt } : message,
        ) ?? null,
    );
  }

  /** True until the player scrolls up to read older messages, and before the log exists. */
  private following(): boolean {
    const log = this.log()?.nativeElement;
    return !log || log.scrollHeight - log.scrollTop - log.clientHeight <= FOLLOW_MARGIN_PX;
  }

  private scrollToEnd(): void {
    this.afterRender((log) => (log.scrollTop = log.scrollHeight));
  }

  private afterRender(action: (log: HTMLElement) => void): void {
    afterNextRender(
      () => {
        const log = this.log()?.nativeElement;
        if (log) action(log);
      },
      { injector: this.injector },
    );
  }
}
