import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { errorText } from '../../core/api/error-text';
import { AuthSession } from '../../core/auth/auth-session';
import { SessionLifecycle } from '../../core/auth/session-lifecycle';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { PresenceBadge } from '../../shared/presence-badge';
import { UserAvatar } from '../../shared/user-avatar';
import { EloChart } from '../../shared/elo-chart';
import { PlayerStatsPanel } from '../progression/player-stats';
import { outcomeText, playerLabel } from '../../shared/chess/game-text';
import { Challenges } from './challenge';
import { GameHistoryItem, GamesApi } from '../game/games-api';
import {
  FRIEND_ERRORS,
  FriendRequest,
  PresenceStatus,
  presenceChanges,
  PublicProfile,
  RatingChange,
  socialEvents,
  UsersApi,
} from './users-api';

/**
 * What the signed-in visitor can do about a friendship with this player: `sent` and
 * `received` are pending requests one way or the other, `pending` one the server reported.
 */
export type Friendship =
  'unknown' | 'none' | 'friends' | 'sent' | 'received' | 'pending' | 'failed';

/** Rated games drawn on the rating curve; the list below it shows the latest few. */
export const PROFILE_RATING_POINTS = 100;
export const PROFILE_RATING_CHANGES = 10;
export const PROFILE_RECENT_GAMES = 5;

/** Public profile (spec §4); the owner also sees their results and links to their account. */
@Component({
  selector: 'app-profile-page',
  imports: [DatePipe, EloChart, PlayerStatsPanel, PresenceBadge, RouterLink, UserAvatar],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
})
export class ProfilePage {
  private readonly users = inject(UsersApi);
  private readonly games = inject(GamesApi);
  private readonly lifecycle = inject(SessionLifecycle);
  private readonly session = inject(AuthSession);
  private readonly challenges = inject(Challenges);
  readonly challenging = signal(false);
  readonly challengeError = signal<string | null>(null);

  readonly userId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: '' },
  );
  readonly profile = signal<PublicProfile | null>(null);
  readonly error = signal<string | null>(null);
  readonly ratings = signal<RatingChange[] | null>(null);
  readonly recent = signal<GameHistoryItem[] | null>(null);
  readonly sideFailed = signal({ ratings: false, recent: false });
  readonly listed = PROFILE_RATING_CHANGES;
  /** A pushed presence change is newer than the profile it follows. */
  private readonly pushed = signal<PresenceStatus | null>(null);

  /** Only the id: refreshing the signed-in user's counters must not reload the page. */
  private readonly signedInId = computed(() => this.session.user()?.id);
  readonly mine = computed(() => this.signedInId() === this.userId());
  /** Any signed-in visitor can write to another player; no friendship is required. */
  readonly canMessage = computed(() => Boolean(this.signedInId()) && !this.mine());
  readonly status = computed<PresenceStatus>(
    () => this.pushed() ?? (this.profile()?.online ? 'ONLINE' : 'OFFLINE'),
  );
  readonly friendship = signal<Friendship>('unknown');
  /** The pending request between the visitor and this player, either way. */
  readonly request = signal<FriendRequest | null>(null);
  readonly requestError = signal('The request could not be sent. Try again.');
  /** Set when a request turned out to answer theirs: you became friends at once. */
  readonly becameFriends = signal(false);
  readonly sending = signal(false);
  /** Null until known, and for the visitor's own profile. */
  readonly blocked = signal<boolean | null>(null);
  readonly confirmingBlock = signal(false);
  readonly blockError = signal<string | null>(null);
  readonly opponent = playerLabel;
  readonly outcome = outcomeText;

  constructor() {
    effect(() => {
      const id = this.userId();
      const mine = this.mine();
      const visitor = this.signedInId();
      untracked(() => {
        this.load(id, mine);
        this.loadFriendship(id, Boolean(visitor) && !mine);
      });
    });
    const realtime = inject(RealtimeService);
    const destroy = inject(DestroyRef);
    presenceChanges(realtime)
      .pipe(takeUntilDestroyed(destroy))
      .subscribe(({ userId, status }) => {
        if (userId === this.userId()) this.pushed.set(status);
      });
    // The other player, or another tab, may answer or withdraw while this page is open.
    socialEvents(realtime)
      .pipe(takeUntilDestroyed(destroy))
      .subscribe((event) => {
        const id = this.userId();
        if (this.mine() || this.blocked()) return;
        if (event.type === 'friend-added' && event.friend.id === id) {
          this.request.set(null);
          this.friendship.set('friends');
        } else if (event.type === 'friend-removed' && event.userId === id) {
          this.friendship.set('none');
        } else if (event.type === 'request-removed' && event.requestId === this.request()?.id) {
          this.request.set(null);
          this.friendship.set('none');
        } else if (event.type === 'request-received' && event.request.senderId === id) {
          this.request.set(event.request);
          this.friendship.set('received');
        } else if (event.type === 'request-sent' && event.request.recipientId === id) {
          this.request.set(event.request);
          this.friendship.set('sent');
        }
      });
  }

  challenge(id: string): void {
    if (this.challenging()) return;
    this.challenging.set(true);
    this.challengeError.set(null);
    this.challenges.send(id).subscribe({
      error: (error: unknown) => {
        this.challenging.set(false);
        this.challengeError.set(errorText(error, 'The challenge could not be sent. Try again.'));
      },
      complete: () => this.challenging.set(false),
    });
  }

  addFriend(): void {
    const id = this.userId();
    if (this.sending()) return;
    this.sending.set(true);
    this.becameFriends.set(false);
    this.users.sendFriendRequest(id).subscribe({
      next: (request) => {
        this.sending.set(false);
        if (request.status === 'ACCEPTED') {
          this.request.set(null);
          this.becameFriends.set(true);
          this.friendship.set('friends');
        } else {
          this.request.set(request);
          this.friendship.set('sent');
        }
      },
      error: (error: unknown) => {
        this.sending.set(false);
        const code = error instanceof ApiError ? error.code : '';
        this.requestError.set(
          errorText(error, 'The request could not be sent. Try again.', FRIEND_ERRORS),
        );
        this.friendship.set(
          code === 'ALREADY_FRIENDS'
            ? 'friends'
            : code === 'FRIEND_REQUEST_PENDING'
              ? 'pending'
              : 'failed',
        );
      },
    });
  }

  /** Withdraws the visitor's request, or declines theirs. */
  dropRequest(): void {
    const request = this.request();
    if (!request || this.sending()) return;
    this.answer(this.users.removeFriendRequest(request.id), 'none');
  }

  acceptRequest(): void {
    const request = this.request();
    if (!request || this.sending()) return;
    this.answer(this.users.acceptFriendRequest(request.id), 'friends');
  }

  block(): void {
    const id = this.userId();
    if (this.sending()) return;
    this.sending.set(true);
    this.blockError.set(null);
    this.users.block(id).subscribe({
      next: () => {
        this.sending.set(false);
        this.confirmingBlock.set(false);
        this.blocked.set(true);
        this.request.set(null);
        this.friendship.set('none');
      },
      error: (error: unknown) => {
        this.sending.set(false);
        this.blockError.set(errorText(error, 'This player could not be blocked. Try again.'));
      },
    });
  }

  unblock(): void {
    const id = this.userId();
    if (this.sending()) return;
    this.sending.set(true);
    this.blockError.set(null);
    this.users.unblock(id).subscribe({
      next: () => {
        this.sending.set(false);
        this.blocked.set(false);
      },
      error: (error: unknown) => {
        this.sending.set(false);
        this.blockError.set(errorText(error, 'This player could not be unblocked. Try again.'));
      },
    });
  }

  private answer(call: Observable<unknown>, after: Friendship): void {
    this.sending.set(true);
    call.subscribe({
      next: () => {
        this.sending.set(false);
        this.request.set(null);
        this.friendship.set(after);
      },
      error: (error: unknown) => {
        this.sending.set(false);
        this.request.set(null);
        this.requestError.set(
          errorText(error, 'This request is no longer pending.', {
            FRIEND_REQUEST_NOT_FOUND: 'This request is no longer pending.',
            FRIEND_REQUEST_FINALIZED: 'This request is no longer pending.',
          }),
        );
        this.friendship.set('failed');
        this.loadFriendship(this.userId(), true, true);
      },
    });
  }

  signed(change: number): string {
    return change > 0 ? `+${change}` : `${change}`;
  }

  /**
   * Read from the visitor's own lists; there is no per-pair lookup. A list that fails to load
   * counts as empty: the server still refuses what does not apply.
   */
  private loadFriendship(id: string, applies: boolean, keepFailure = false): void {
    const failed = keepFailure && this.friendship() === 'failed';
    if (!failed) this.friendship.set('unknown');
    this.request.set(null);
    this.becameFriends.set(false);
    this.confirmingBlock.set(false);
    this.blockError.set(null);
    this.blocked.set(null);
    if (!applies) return;
    const empty = { requests: [] as FriendRequest[] };
    forkJoin({
      friends: this.users.friends().pipe(catchError(() => of({ friends: [] }))),
      received: this.users.friendRequests().pipe(catchError(() => of(empty))),
      sent: this.users.sentFriendRequests().pipe(catchError(() => of(empty))),
      blocked: this.users.blocked().pipe(catchError(() => of({ users: [] }))),
    }).subscribe(({ friends, received, sent, blocked }) => {
      if (id !== this.userId()) return;
      this.blocked.set(blocked.users.some((user) => user.id === id));
      const theirs = received.requests.find((request) => request.senderId === id);
      const ours = sent.requests.find((request) => request.recipientId === id);
      this.request.set(theirs ?? ours ?? null);
      const state: Friendship = friends.friends.some((friend) => friend.id === id)
        ? 'friends'
        : theirs
          ? 'received'
          : ours
            ? 'sent'
            : 'none';
      if (!failed || state !== 'none') this.friendship.set(state);
    });
  }

  private load(id: string, mine: boolean): void {
    this.profile.set(null);
    this.error.set(null);
    this.pushed.set(null);
    this.ratings.set(null);
    this.recent.set(null);
    this.sideFailed.set({ ratings: false, recent: false });
    this.users.profile(id).subscribe({
      next: (profile) => this.profile.set(profile),
      error: (error: unknown) => {
        const status = error instanceof ApiError ? error.statusCode : 0;
        this.error.set(
          status === 404 || status === 400
            ? 'This player does not exist.'
            : 'This profile could not be loaded. Try again later.',
        );
      },
    });
    // Secondary sections fail on their own: the profile stays readable without them.
    this.users.ratingHistory(id, PROFILE_RATING_POINTS).subscribe({
      next: ({ history }) => this.ratings.set(history),
      error: () => this.sideFailed.update((failed) => ({ ...failed, ratings: true })),
    });
    this.games.history(id, PROFILE_RECENT_GAMES, 0).subscribe({
      next: ({ items }) => this.recent.set(items),
      error: () => this.sideFailed.update((failed) => ({ ...failed, recent: true })),
    });
    // The header shows the signed-in player's rating: keep it current on their profile.
    if (mine)
      this.lifecycle
        .refreshUser()
        .pipe(catchError(() => of(null)))
        .subscribe();
  }
}
