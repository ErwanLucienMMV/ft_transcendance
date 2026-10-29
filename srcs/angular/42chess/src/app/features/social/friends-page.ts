import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { PresenceBadge } from '../../shared/presence-badge';
import {
  Friend,
  FriendRequest,
  PlayerSearchResult,
  PublicProfile,
  presenceChanges,
  SEARCH_MAX_LENGTH,
  UsersApi,
} from './users-api';

/** No event announces a new request, so the inbox is read again while the page is open. */
export const REQUESTS_REFRESH_MS = 30_000;

export interface IncomingRequest extends FriendRequest {
  /** Null when the sender's profile could not be read; the request stays actionable. */
  sender: PublicProfile | null;
}

/**
 * Player search (kept in `?q=`), incoming friend requests, and the signed-in user's friends
 * with live presence.
 */
@Component({
  selector: 'app-friends-page',
  imports: [PresenceBadge, ReactiveFormsModule, RouterLink],
  templateUrl: './friends-page.html',
  styleUrl: './friends-page.css',
})
export class FriendsPage {
  private readonly users = inject(UsersApi);
  private readonly router = inject(Router);
  private readonly session = inject(AuthSession);
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
  /** Request or friend ids with an action in flight, so their buttons cannot fire twice. */
  readonly busy = signal<ReadonlySet<string>>(new Set());
  readonly confirmingRemoval = signal<string | null>(null);
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
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const timer = setInterval(() => this.loadRequests(), REQUESTS_REFRESH_MS);
      inject(DestroyRef).onDestroy(() => clearInterval(timer));
    }
    presenceChanges(inject(RealtimeService))
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(({ userId, status }) =>
        this.friends.update(
          (list) =>
            list?.map((friend) => (friend.id === userId ? { ...friend, status } : friend)) ?? null,
        ),
      );
  }

  submit(): void {
    const q = this.form.getRawValue().q.trim();
    void this.router.navigate([], { queryParams: { q: q || null } });
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
  }

  accept(request: IncomingRequest): void {
    this.act(request.id, this.users.acceptFriendRequest(request.id), () => {
      this.dropRequest(request.id);
      this.loadFriends();
    });
  }

  reject(request: IncomingRequest): void {
    this.act(request.id, this.users.rejectFriendRequest(request.id), () =>
      this.dropRequest(request.id),
    );
  }

  remove(friend: Friend): void {
    this.act(friend.id, this.users.removeFriend(friend.id), () => {
      this.confirmingRemoval.set(null);
      this.friends.update((list) => list?.filter((item) => item.id !== friend.id) ?? null);
    });
  }

  self(id: string): boolean {
    return id === this.signedInId();
  }

  private withSender(request: FriendRequest): Observable<IncomingRequest> {
    return this.users.profile(request.senderId).pipe(
      map((sender) => ({ ...request, sender })),
      catchError(() => of({ ...request, sender: null })),
    );
  }

  private dropRequest(id: string): void {
    this.requests.update((list) => list?.filter((request) => request.id !== id) ?? null);
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
          this.actionError.set('This request is no longer pending.');
          this.dropRequest(id);
        } else if (code === 'FRIENDSHIP_NOT_FOUND') {
          this.actionError.set('You are no longer friends with this player.');
          this.loadFriends();
        } else {
          this.actionError.set('That did not work. Try again.');
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
