import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import { UserAvatar } from '../../shared/user-avatar';
import { LEADERBOARD_PAGE, LeaderboardRow, ProgressionApi } from './progression-api';

/** Page holding a rank: `?rank=` (from a profile) opens the page that shows it. */
export function pageOf(rank: number): number {
  return Math.max(1, Math.ceil(rank / LEADERBOARD_PAGE));
}

/**
 * Players with a rated game, best rating first. The signed-in player's row is marked, and a
 * link opens the page that holds it.
 */
@Component({
  selector: 'app-leaderboard-page',
  imports: [RouterLink, UserAvatar],
  templateUrl: './leaderboard-page.html',
  styleUrl: './leaderboard-page.css',
})
export class LeaderboardPage {
  private readonly api = inject(ProgressionApi);
  private readonly router = inject(Router);
  readonly session = inject(AuthSession);

  readonly page = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(
      map((params) => {
        const rank = Number(params.get('rank'));
        if (Number.isSafeInteger(rank) && rank >= 1) return pageOf(rank);
        const page = Number(params.get('page') ?? 1);
        return Number.isSafeInteger(page) && page >= 1 ? page : 1;
      }),
    ),
    { initialValue: 1 },
  );
  readonly rows = signal<LeaderboardRow[] | null>(null);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly failed = signal(false);
  /** The signed-in player's rank, or null when unranked or signed out. */
  readonly myRank = signal<number | null>(null);
  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / LEADERBOARD_PAGE)));
  readonly meShown = computed(() => {
    const id = this.session.user()?.id;
    return !!id && !!this.rows()?.some((row) => row.id === id);
  });

  constructor() {
    effect(() => {
      const page = this.page();
      untracked(() => this.load(page));
    });
    effect(() => {
      const id = this.session.user()?.id;
      untracked(() => {
        this.myRank.set(null);
        if (id)
          this.api.stats(id).subscribe({
            next: (stats) => this.myRank.set(stats.rank),
            error: () => this.myRank.set(null),
          });
      });
    });
  }

  mine(row: LeaderboardRow): boolean {
    return row.id === this.session.user()?.id;
  }

  go(page: number): void {
    void this.router.navigate([], { queryParams: { page: page === 1 ? null : page } });
  }

  showMine(): void {
    const rank = this.myRank();
    if (rank !== null) this.go(pageOf(rank));
  }

  retry(): void {
    this.load(this.page());
  }

  private load(page: number): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api.leaderboard((page - 1) * LEADERBOARD_PAGE).subscribe({
      next: ({ items, total }) => {
        this.rows.set(items);
        this.total.set(total);
        this.loading.set(false);
        if (items.length === 0 && total > 0) this.go(this.pages());
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
      },
    });
  }
}
