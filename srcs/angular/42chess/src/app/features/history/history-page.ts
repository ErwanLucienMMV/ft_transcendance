import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import { endReason, playerLabel } from '../../shared/chess/game-text';
import { GameHistoryItem, GamesApi, Page, timeControlLabel } from '../game/games-api';

export const HISTORY_PAGE_SIZE = 10;
const OUTCOMES: Record<GameHistoryItem['outcome'], string> = {
  WIN: 'Won',
  LOSS: 'Lost',
  DRAW: 'Draw',
};

/** The signed-in player's finished games, newest first, ten per page (`?page=` keeps the place). */
@Component({
  selector: 'app-history-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './history-page.html',
  styleUrl: './history-page.css',
})
export class HistoryPage {
  private readonly api = inject(GamesApi);
  private readonly router = inject(Router);
  private readonly session = inject(AuthSession);

  readonly page = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(
      map((params) => {
        const page = Number(params.get('page') ?? 1);
        return Number.isSafeInteger(page) && page >= 1 ? page : 1;
      }),
    ),
    { initialValue: 1 },
  );
  readonly result = signal<Page<GameHistoryItem> | null>(null);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly pages = computed(() =>
    Math.max(1, Math.ceil((this.result()?.total ?? 0) / HISTORY_PAGE_SIZE)),
  );

  constructor() {
    effect(() => {
      const page = this.page();
      const user = this.session.user()?.id;
      if (user) untracked(() => this.load(user, page));
    });
  }

  outcome(item: GameHistoryItem): string {
    return OUTCOMES[item.outcome];
  }

  opponent(item: GameHistoryItem): string {
    return playerLabel(item.opponent);
  }

  details(item: GameHistoryItem): string {
    const reason = endReason(item.reason);
    const moves = Math.ceil(item.moveCount / 2);
    return [
      `${item.color === 'WHITE' ? 'White' : 'Black'}`,
      reason,
      timeControlLabel(item.timeControl),
      `${moves} ${moves === 1 ? 'move' : 'moves'}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  go(page: number): void {
    void this.router.navigate([], { queryParams: { page: page === 1 ? null : page } });
  }

  retry(): void {
    const user = this.session.user()?.id;
    if (user) this.load(user, this.page());
  }

  private load(user: string, page: number): void {
    this.loading.set(true);
    this.failed.set(false);
    this.api.history(user, HISTORY_PAGE_SIZE, (page - 1) * HISTORY_PAGE_SIZE).subscribe({
      next: (result) => {
        this.result.set(result);
        this.loading.set(false);
        // A page past the end (games are never removed, but a typed URL can be) goes to the last.
        if (result.items.length === 0 && result.total > 0) this.go(this.pages());
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
      },
    });
  }
}
