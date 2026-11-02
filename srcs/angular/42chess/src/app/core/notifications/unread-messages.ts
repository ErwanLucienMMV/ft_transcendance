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
 * tab title. The conversation list gives the starting counts; PRIVATE_MESSAGE adds one and
 * MESSAGES_READ (sent when this player opens a conversation, in any tab) clears a sender.
 */
@Injectable({ providedIn: 'root' })
export class UnreadMessages {
  private readonly api = inject(ApiClient);
  private readonly session = inject(AuthSession);
  private readonly bySender = signal<ReadonlyMap<string, number>>(new Map());
  readonly total = computed(() => [...this.bySender().values()].reduce((sum, n) => sum + n, 0));

  constructor() {
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    let loaded: string | null = null;
    effect(() => {
      const id = this.session.user()?.id ?? null;
      if (id === loaded) return;
      loaded = id;
      untracked(() => {
        this.bySender.set(new Map());
        if (id && browser) this.load(id);
      });
    });
    const realtime = inject(RealtimeService);
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
    if (!this.bySender().has(senderId)) return;
    this.bySender.update((counts) => {
      const next = new Map(counts);
      next.delete(senderId);
      return next;
    });
  }

  private add(senderId: string, count: number): void {
    this.bySender.update((counts) =>
      new Map(counts).set(senderId, (counts.get(senderId) ?? 0) + count),
    );
  }

  private load(id: string): void {
    this.api
      .get<{ conversations: { user: { id: string }; unreadCount: number }[] }>('conversations')
      .subscribe({
        next: ({ conversations }) => {
          if (this.session.user()?.id !== id) return;
          // Messages that arrived while the list was loading are counted once.
          this.bySender.set(
            new Map(
              conversations
                .filter((conversation) => conversation.unreadCount > 0)
                .map((conversation) => [conversation.user.id, conversation.unreadCount]),
            ),
          );
        },
        error: () => undefined,
      });
  }
}
