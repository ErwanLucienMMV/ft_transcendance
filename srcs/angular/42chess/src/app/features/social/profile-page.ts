import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import { CurrentUser, SessionLifecycle } from '../../core/auth/session-lifecycle';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { PresenceBadge } from '../../shared/presence-badge';
import { outcomeText, playerLabel } from '../../shared/chess/game-text';
import { GameHistoryItem, GamesApi } from '../game/games-api';
import {
  PresenceStatus,
  presenceChanges,
  PublicProfile,
  RatingChange,
  UsersApi,
} from './users-api';

/** What the signed-in visitor can do about a friendship with this player. */
export type Friendship = 'unknown' | 'none' | 'friends' | 'sent' | 'pending' | 'failed';

export const PROFILE_RATING_CHANGES = 10;
export const PROFILE_RECENT_GAMES = 5;

/** Public profile (spec §4); the owner also sees their results and links to their account. */
@Component({
  selector: 'app-profile-page',
  imports: [DatePipe, PresenceBadge, RouterLink],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.css',
})
export class ProfilePage {
  private readonly users = inject(UsersApi);
  private readonly games = inject(GamesApi);
  private readonly lifecycle = inject(SessionLifecycle);
  private readonly session = inject(AuthSession);

  readonly userId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: '' },
  );
  readonly profile = signal<PublicProfile | null>(null);
  readonly error = signal<string | null>(null);
  readonly ratings = signal<RatingChange[] | null>(null);
  readonly recent = signal<GameHistoryItem[] | null>(null);
  readonly sideFailed = signal({ ratings: false, recent: false });
  /** The owner's own counters, from GET /users/me. */
  readonly own = signal<CurrentUser | null>(null);
  /** A pushed presence change is newer than the profile it follows. */
  private readonly pushed = signal<PresenceStatus | null>(null);

  /** Only the id: refreshing the signed-in user's counters must not reload the page. */
  private readonly signedInId = computed(() => this.session.user()?.id);
  readonly mine = computed(() => this.signedInId() === this.userId());
  readonly status = computed<PresenceStatus>(
    () => this.pushed() ?? (this.profile()?.online ? 'ONLINE' : 'OFFLINE'),
  );
  readonly initial = computed(() => this.profile()?.username.charAt(0).toUpperCase() ?? '');
  readonly avatarFailed = signal(false);
  readonly friendship = signal<Friendship>('unknown');
  readonly sending = signal(false);
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
    presenceChanges(inject(RealtimeService))
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(({ userId, status }) => {
        if (userId === this.userId()) this.pushed.set(status);
      });
  }

  addFriend(): void {
    const id = this.userId();
    if (this.sending()) return;
    this.sending.set(true);
    this.users.sendFriendRequest(id).subscribe({
      next: () => {
        this.sending.set(false);
        this.friendship.set('sent');
      },
      error: (error: unknown) => {
        this.sending.set(false);
        const code = error instanceof ApiError ? error.code : '';
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

  signed(change: number): string {
    return change > 0 ? `+${change}` : `${change}`;
  }

  /** Friends are read from the visitor's own list; there is no per-pair lookup. */
  private loadFriendship(id: string, applies: boolean): void {
    this.friendship.set('unknown');
    if (!applies) return;
    this.users.friends().subscribe({
      next: ({ friends }) =>
        this.friendship.set(friends.some((friend) => friend.id === id) ? 'friends' : 'none'),
      // Offer the request anyway: the server answers ALREADY_FRIENDS if it is one.
      error: () => this.friendship.set('none'),
    });
  }

  private load(id: string, mine: boolean): void {
    this.profile.set(null);
    this.error.set(null);
    this.pushed.set(null);
    this.avatarFailed.set(false);
    this.ratings.set(null);
    this.recent.set(null);
    this.sideFailed.set({ ratings: false, recent: false });
    this.own.set(null);
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
    this.users.ratingHistory(id, PROFILE_RATING_CHANGES).subscribe({
      next: ({ history }) => this.ratings.set(history),
      error: () => this.sideFailed.update((failed) => ({ ...failed, ratings: true })),
    });
    this.games.history(id, PROFILE_RECENT_GAMES, 0).subscribe({
      next: ({ items }) => this.recent.set(items),
      error: () => this.sideFailed.update((failed) => ({ ...failed, recent: true })),
    });
    if (mine)
      this.lifecycle
        .refreshUser()
        .pipe(catchError(() => of(null)))
        .subscribe((user) => this.own.set(user));
  }
}
