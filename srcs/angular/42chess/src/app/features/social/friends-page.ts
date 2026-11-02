import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { errorText } from '../../core/api/error-text';
import { AuthSession } from '../../core/auth/auth-session';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { PresenceBadge } from '../../shared/presence-badge';
import { UserAvatar } from '../../shared/user-avatar';
import { Challenges } from './challenge';
import {
  Friend,
  friendErrors,
  FriendRequest,
  PlayerSearchResult,
  presenceChanges,
  RequestPlayer,
  SEARCH_MAX_LENGTH,
  SocialEvent,
  socialEvents,
  UsersApi,
} from './users-api';
import { Alert } from '../../shared/ui/alert';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { EmptyState } from '../../shared/ui/empty-state';
import { tr } from '../../core/i18n/i18n';
import { TranslocoDirective } from '@jsverse/transloco';

export interface IncomingRequest extends FriendRequest {
  /** Null when the sender's profile could not be read; the request stays actionable. */
  sender: RequestPlayer | null;
}
export interface SentRequest extends FriendRequest {
  recipient: RequestPlayer | null;
}

function byName(a: Friend, b: Friend): number {
  return (
    a.username.toLowerCase().localeCompare(b.username.toLowerCase()) || a.id.localeCompare(b.id)
  );
}

/**
 * Player search (kept in `?q=`), friend requests both ways, and the signed-in user's friends
 * with live presence. Requests and friendships change live, from any tab or the other player.
 */
@Component({
  selector: 'app-friends-page',
  imports: [
    TranslocoDirective,
    ConfirmDialog,
    EmptyState,
    Alert,
    PresenceBadge,
    ReactiveFormsModule,
    RouterLink,
    UserAvatar,
  ],
  templateUrl: './friends-page.html',
  styleUrl: './friends-page.css',
})
export class FriendsPage {
  private readonly users = inject(UsersApi);
  private readonly router = inject(Router);
  private readonly session = inject(AuthSession);
  private readonly challenges = inject(Challenges);
  readonly challenging = signal<string | null>(null);
  readonly challengeError = signal<string | null>(null);
  readonly maxLength = SEARCH_MAX_LENGTH;
  private readonly signedInId = computed(() => this.session.user()?.id);

  readonly query = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(
      map((params) => (params.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH)),
    ),
    { initialValue: '' },
  );
  /** The text field starts from the address, and submitting puts it back there. */
  readonly form = new FormGroup({ q: new FormControl('', { nonNullable: true }) });
  readonly results = signal<PlayerSearchResult[] | null>(null);
  readonly searching = signal(false);
  readonly searchFailed = signal(false);

  readonly friends = signal<Friend[] | null>(null);
  readonly friendsFailed = signal(false);
  readonly requests = signal<IncomingRequest[] | null>(null);
  readonly sent = signal<SentRequest[] | null>(null);
  /** Request or friend ids with an action in flight, so their buttons cannot fire twice. */
  readonly busy = signal<ReadonlySet<string>>(new Set());
  /** The friend the removal dialog asks about. */
  readonly removing = signal<Friend | null>(null);
  private readonly removal = viewChild.required<ConfirmDialog>('removal');
  readonly actionError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const q = this.query();
      untracked(() => {
        this.form.setValue({ q });
        this.search(q);
      });
    });
    effect(() => {
      if (!this.signedInId()) return;
      untracked(() => {
        this.loadFriends();
        this.loadRequests();
      });
    });
    const realtime = inject(RealtimeService);
    // Events missed while the socket was down are not replayed: read everything again.
    let previous = realtime.state();
    effect(() => {
      const state = realtime.state();
      const reconnected = state === 'connected' && previous !== 'connected';
      previous = state;
      if (reconnected && this.signedInId())
        untracked(() => {
          this.loadFriends();
          this.loadRequests();
        });
    });
    const destroy = inject(DestroyRef);
    presenceChanges(realtime)
      .pipe(takeUntilDestroyed(destroy))
      .subscribe(({ userId, status }) =>
        this.friends.update(
          (list) =>
            list?.map((friend) => (friend.id === userId ? { ...friend, status } : friend)) ?? null,
        ),
      );
    socialEvents(realtime)
      .pipe(takeUntilDestroyed(destroy))
      .subscribe((event) => this.apply(event));
  }

  submit(): void {
    const q = this.form.getRawValue().q.trim();
    void this.router.navigate([], { queryParams: { q: q || null } });
  }

  challenge(friend: { id: string }): void {
    if (this.challenging()) return;
    this.challenging.set(friend.id);
    this.challengeError.set(null);
    this.challenges.send(friend.id).subscribe({
      error: (error: unknown) => {
        this.challenging.set(null);
        this.challengeError.set(errorText(error, tr('social.friends.challengeFailed')));
      },
      complete: () => this.challenging.set(null),
    });
  }

  loadFriends(): void {
    this.friendsFailed.set(false);
    this.users.friends().subscribe({
      next: ({ friends }) => this.friends.set(friends),
      error: () => this.friendsFailed.set(true),
    });
  }

  loadRequests(): void {
    this.users
      .friendRequests()
      .pipe(
        switchMap(({ requests }) =>
          requests.length
            ? forkJoin(requests.map((request) => this.withSender(request)))
            : of([] as IncomingRequest[]),
        ),
      )
      // A failed refresh keeps the list already shown; the next one tries again.
      .subscribe({ next: (requests) => this.requests.set(requests), error: () => {} });
    this.users
      .sentFriendRequests()
      .pipe(
        switchMap(({ requests }) =>
          requests.length
            ? forkJoin(requests.map((request) => this.withRecipient(request)))
            : of([] as SentRequest[]),
        ),
      )
      .subscribe({ next: (requests) => this.sent.set(requests), error: () => {} });
  }

  accept(request: IncomingRequest): void {
    this.act(request.id, this.users.acceptFriendRequest(request.id), () => {
      this.dropRequest(request.id);
      this.loadFriends();
    });
  }

  reject(request: IncomingRequest): void {
    this.act(request.id, this.users.removeFriendRequest(request.id), () =>
      this.dropRequest(request.id),
    );
  }

  /** Withdraws a request this player sent: it disappears from the other player's list. */
  cancel(request: SentRequest): void {
    this.act(request.id, this.users.removeFriendRequest(request.id), () =>
      this.dropRequest(request.id),
    );
  }

  askRemoval(friend: Friend): void {
    this.removing.set(friend);
    this.removal().open();
  }

  removeConfirmed(): void {
    const friend = this.removing();
    this.removing.set(null);
    if (!friend) return;
    this.act(friend.id, this.users.removeFriend(friend.id), () =>
      this.friends.update((list) => list?.filter((item) => item.id !== friend.id) ?? null),
    );
  }

  self(id: string): boolean {
    return id === this.signedInId();
  }

  private player(id: string): Observable<RequestPlayer | null> {
    return this.users.profile(id).pipe(
      map(({ id, username, avatarUrl, elo }) => ({ id, username, avatarUrl, elo })),
      catchError(() => of(null)),
    );
  }

  private withSender(request: FriendRequest): Observable<IncomingRequest> {
    return this.player(request.senderId).pipe(map((sender) => ({ ...request, sender })));
  }

  private withRecipient(request: FriendRequest): Observable<SentRequest> {
    return this.player(request.recipientId).pipe(map((recipient) => ({ ...request, recipient })));
  }

  private dropRequest(id: string): void {
    this.requests.update((list) => list?.filter((request) => request.id !== id) ?? null);
    this.sent.update((list) => list?.filter((request) => request.id !== id) ?? null);
  }

  private apply(event: SocialEvent): void {
    switch (event.type) {
      case 'request-received':
        this.requests.update((list) =>
          list?.some((request) => request.id === event.request.id)
            ? list
            : [...(list ?? []), { ...event.request, sender: event.sender }],
        );
        break;
      case 'request-sent': {
        const request = event.request;
        if (this.sent()?.some((known) => known.id === request.id)) break;
        this.withRecipient(request).subscribe((added) =>
          this.sent.update((list) =>
            list?.some((known) => known.id === added.id) ? list : [...(list ?? []), added],
          ),
        );
        break;
      }
      case 'request-removed':
        this.dropRequest(event.requestId);
        break;
      case 'friend-added':
        if (event.requestId) this.dropRequest(event.requestId);
        this.friends.update((list) =>
          list && !list.some((friend) => friend.id === event.friend.id)
            ? [...list, event.friend].sort(byName)
            : list,
        );
        // A crossed request may be listed under either id: drop any left with this player.
        this.requests.update(
          (list) => list?.filter((request) => request.senderId !== event.friend.id) ?? null,
        );
        this.sent.update(
          (list) => list?.filter((request) => request.recipientId !== event.friend.id) ?? null,
        );
        break;
      case 'friend-removed':
        this.friends.update((list) => list?.filter((friend) => friend.id !== event.userId) ?? null);
        // Already gone (removed from another tab or by the friend): nothing left to confirm.
        if (this.removing()?.id === event.userId) this.removal().answer(false);
        break;
    }
  }

  private act(id: string, call: Observable<unknown>, done: () => void): void {
    if (this.busy().has(id)) return;
    this.actionError.set(null);
    this.busy.update((ids) => new Set(ids).add(id));
    const release = () =>
      this.busy.update((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
    call.subscribe({
      next: () => {
        release();
        done();
      },
      error: (error: unknown) => {
        release();
        const code = error instanceof ApiError ? error.code : '';
        if (code === 'FRIEND_REQUEST_FINALIZED' || code === 'FRIEND_REQUEST_NOT_FOUND') {
          this.actionError.set(tr('social.friends.notPending'));
          this.dropRequest(id);
        } else if (code === 'FRIENDSHIP_NOT_FOUND') {
          this.actionError.set(tr('social.friends.noLongerFriends'));
          this.loadFriends();
        } else {
          this.actionError.set(errorText(error, tr('social.friends.failedAction'), friendErrors()));
        }
      },
    });
  }

  private search(q: string): void {
    this.searchFailed.set(false);
    if (!q) {
      this.results.set(null);
      return;
    }
    this.searching.set(true);
    this.users.search(q).subscribe({
      next: ({ users }) => {
        // A slower answer for an older query must not replace the current one.
        if (q !== this.query()) return;
        this.results.set(users);
        this.searching.set(false);
      },
      error: () => {
        if (q !== this.query()) return;
        this.results.set(null);
        this.searching.set(false);
        this.searchFailed.set(true);
      },
    });
  }
}
