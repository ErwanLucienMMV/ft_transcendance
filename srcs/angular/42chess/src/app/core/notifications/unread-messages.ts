import { isPlatformBrowser } from '@angular/common';
import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { ApiClient } from '../api/api-client';
import { AuthSession } from '../auth/auth-session';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * Unread private messages of the signed-in player, by sender, for the header badge and the
 * tab title. The conversation list gives the starting counts, again after each reconnection
 * (events sent while offline are lost); PRIVATE_MESSAGE adds one and MESSAGES_READ (sent
 * when this player opens a conversation, in any tab) clears a sender.
 */
@Injectable({ providedIn: 'root' })
export class UnreadMessages {
  private readonly api = inject(ApiClient);
  private readonly session = inject(AuthSession);
  private readonly bySender = signal<ReadonlyMap<string, number>>(new Map());
  readonly total = computed(() => [...this.bySender().values()].reduce((sum, n) => sum + n, 0));
  /** What the events changed while the conversation list was loading, by sender. */
  private changes: Map<string, { added: number; cleared: boolean }> | null = null;

  constructor() {
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    const realtime = inject(RealtimeService);
    let user: string | null = null;
    let online = false;
    effect(() => {
      const id = this.session.user()?.id ?? null;
      const connected = realtime.state() === 'connected';
      const signedIn = id !== user;
      const reconnected = connected && !online;
      user = id;
      online = connected;
      if (!signedIn && !reconnected) return;
      untracked(() => {
        if (signedIn) this.bySender.set(new Map());
        if (id && browser) this.load(id);
      });
    });
    const subscription = realtime.events.subscribe(({ event, data }) => {
      const me = this.session.user()?.id;
      if (!me) return;
      if (
        event === 'PRIVATE_MESSAGE' &&
        data['receiverId'] === me &&
        typeof data['senderId'] === 'string' &&
        data['senderId'] !== me
      )
        this.add(data['senderId'], 1);
      if (
        event === 'MESSAGES_READ' &&
        data['readerId'] === me &&
        typeof data['senderId'] === 'string'
      )
        this.clear(data['senderId']);
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  /** The messages page shows a conversation as read before the server confirms it. */
  clear(senderId: string): void {
    this.changes?.set(senderId, { added: 0, cleared: true });
    if (!this.bySender().has(senderId)) return;
    this.bySender.update((counts) => {
      const next = new Map(counts);
      next.delete(senderId);
      return next;
    });
  }

  private add(senderId: string, count: number): void {
    const change = this.changes?.get(senderId) ?? { added: 0, cleared: false };
    this.changes?.set(senderId, { ...change, added: change.added + count });
    this.bySender.update((counts) =>
      new Map(counts).set(senderId, (counts.get(senderId) ?? 0) + count),
    );
  }

  private load(id: string): void {
    const changes = new Map<string, { added: number; cleared: boolean }>();
    this.changes = changes;
    this.api
      .get<{ conversations: { user: { id: string }; unreadCount: number }[] }>('conversations')
      .subscribe({
        next: ({ conversations }) => {
          // A newer load replaced this one.
          if (this.changes !== changes) return;
          this.changes = null;
          if (this.session.user()?.id !== id) return;
          const counts = new Map(
            conversations
              .filter((conversation) => conversation.unreadCount > 0)
              .map((conversation) => [conversation.user.id, conversation.unreadCount]),
          );
          // A message that arrived while the list was loading may or may not be in it:
          // counted once either way. A conversation read meanwhile starts from zero.
          for (const [sender, { added, cleared }] of changes) {
            const count = Math.max(cleared ? 0 : (counts.get(sender) ?? 0), added);
            if (count) counts.set(sender, count);
            else counts.delete(sender);
          }
          this.bySender.set(counts);
        },
        error: () => {
          if (this.changes === changes) this.changes = null;
        },
      });
  }
}
