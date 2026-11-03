import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime, filter } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { playerLabel, seatOf } from '../../shared/chess/game-text';
import { Alert } from '../../shared/ui/alert';
import { EmptyState } from '../../shared/ui/empty-state';
import { Segmented, SegmentOption } from '../../shared/ui/segmented';
import {
  GamesApi,
  LiveGame,
  TimeCategory,
  timeCategory,
  timeControlLabel,
} from '../game/games-api';
import { tr, trCount } from '../../core/i18n/i18n';
import { TranslocoDirective } from '@jsverse/transloco';

/** Without a live connection (signed out), the list is reloaded this often. */
export const LIVE_REFRESH_MS = 15_000;
/**
 * Signed in, the server announces each game that starts or ends (LIVE_GAMES_CHANGED); the
 * list is still reloaded now and then for the spectator counts.
 */
export const LIVE_SLOW_REFRESH_MS = 60_000;
/** Several games starting together cause one reload. */
export const LIVE_EVENT_DELAY_MS = 300;

type Filter = 'All' | TimeCategory;
export const LIVE_FILTERS: readonly Filter[] = ['All', 'Bullet', 'Blitz', 'Rapid', 'Classical'];

/** Games in progress; a signed-in user opens one as a spectator, a player opens their own seat. */
@Component({
  selector: 'app-live-page',
  imports: [TranslocoDirective, Alert, EmptyState, RouterLink, Segmented],
  templateUrl: './live-page.html',
  styleUrl: './live-page.css',
})
export class LivePage {
  private readonly api = inject(GamesApi);
  private readonly session = inject(AuthSession);
  private readonly realtime = inject(RealtimeService);
  readonly games = signal<LiveGame[] | null>(null);
  readonly loading = signal(false);
  readonly failed = signal(false);
  readonly filters = computed<SegmentOption<Filter>[]>(() =>
    LIVE_FILTERS.map((value) => ({
      value,
      label: value === 'All' ? tr('live.all') : tr(`play.categories.${value}`),
    })),
  );
  readonly filter = signal<Filter>('All');
  readonly shown = computed(() => {
    const games = this.games() ?? [];
    const filter = this.filter();
    return filter === 'All'
      ? games
      : games.filter((game) => timeCategory(game.timeControl) === filter);
  });
  readonly timeControlLabel = timeControlLabel;
  readonly category = timeCategory;
  readonly name = playerLabel;
  elsewhere(count: number): string {
    return trCount('live.elsewhere', count);
  }
  spectators(count: number): string {
    return trCount('live.spectators', count);
  }
  private loadedAt = 0;
  /** An announcement that arrived during a reload asks for one more. */
  private stale = false;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    this.refresh();
    const timer = setInterval(() => {
      const live = this.realtime.state() === 'connected';
      if (!live || Date.now() - this.loadedAt >= LIVE_SLOW_REFRESH_MS) this.refresh();
    }, LIVE_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    this.realtime.events
      .pipe(
        filter(({ event }) => event === 'LIVE_GAMES_CHANGED'),
        debounceTime(LIVE_EVENT_DELAY_MS),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.refresh());
  }

  refresh(): void {
    if (this.loading()) {
      this.stale = true;
      return;
    }
    this.stale = false;
    this.loading.set(true);
    this.api.live().subscribe({
      next: ({ games }) => {
        this.games.set(games);
        this.failed.set(false);
        this.loading.set(false);
        this.loadedAt = Date.now();
        if (this.stale) this.refresh();
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
        this.stale = false;
      },
    });
  }

  /** My own games open as the player; any other one opens read-only. */
  mine(game: LiveGame): boolean {
    return seatOf(game, this.session.user()?.id) !== null;
  }
}
