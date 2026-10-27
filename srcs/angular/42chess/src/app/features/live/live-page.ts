import { isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthSession } from '../../core/auth/auth-session';
import { playerLabel, seatOf } from '../../shared/chess/game-text';
import { GamesApi, LiveGame, timeControlLabel } from '../game/games-api';

/** The list follows new games and spectator counts without a reload. */
export const LIVE_REFRESH_MS = 15_000;

/** Games in progress; a signed-in user opens one as a spectator, a player opens their own seat. */
@Component({
  selector: 'app-live-page',
  imports: [RouterLink],
  templateUrl: './live-page.html',
  styleUrl: './live-page.css',
})
export class LivePage {
  private readonly api = inject(GamesApi);
  private readonly session = inject(AuthSession);
  readonly games = signal<LiveGame[] | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly timeControlLabel = timeControlLabel;
  readonly name = playerLabel;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    this.refresh();
    const timer = setInterval(() => this.refresh(), LIVE_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  refresh(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.api.live().subscribe({
      next: ({ games }) => {
        this.games.set(games);
        this.failed.set(false);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  /** My own games open as the player; any other one opens read-only. */
  mine(game: LiveGame): boolean {
    return seatOf(game, this.session.user()?.id) !== null;
  }
}
