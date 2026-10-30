import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { filter, Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { ApiError } from '../../core/api/api-error';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { GamesApi, TimeControl } from './games-api';

/** GET /v1/matchmaking/status. A MATCHED entry keeps its game after that game ends. */
export interface QueueStatus {
  status: 'IDLE' | 'WAITING' | 'MATCHED' | 'CANCELLED';
  joinedAt?: string;
  gameId?: string;
}
export type SearchState = 'idle' | 'joining' | 'waiting' | 'leaving';

/**
 * A search lasts as long as its 30 s lease, which only POST heartbeat renews. The heartbeat also
 * returns the queue status, so it doubles as the fallback for a missed MATCH_FOUND.
 */
export const MATCHMAKING_HEARTBEAT_MS = 5_000;

const JOIN_ERRORS: Record<string, string> = {
  ACTIVE_GAME_EXISTS: 'You already have a game in progress. Finish it before looking for another.',
};

@Injectable({ providedIn: 'root' })
export class MatchmakingApi {
  private readonly api = inject(ApiClient);

  status(): Observable<QueueStatus> {
    return this.api.get('matchmaking/status');
  }

  join(timeControl: TimeControl): Observable<{ status: 'WAITING'; joinedAt: string }> {
    return this.api.post('matchmaking/join', { timeControl });
  }

  heartbeat(): Observable<QueueStatus> {
    return this.api.post('matchmaking/heartbeat', {});
  }

  leave(): Observable<QueueStatus> {
    return this.api.post('matchmaking/leave', {});
  }
}

/**
 * One player's search for a rated opponent, owned by the page that shows it. The server pairs
 * players with the same time control and a close enough Elo, then sends MATCH_FOUND; the page
 * opens the game. Leaving the page leaves the queue, so nobody is matched while away.
 */
@Injectable()
export class MatchmakingSearch {
  private readonly api = inject(MatchmakingApi);
  private readonly games = inject(GamesApi);
  private readonly router = inject(Router);
  private readonly realtime = inject(RealtimeService);
  readonly state = signal<SearchState>('idle');
  readonly joinedAt = signal<number | null>(null);
  readonly timeControl = signal<TimeControl | null>(null);
  readonly error = signal<string | null>(null);
  private heartbeat?: ReturnType<typeof setInterval>;
  private opened = false;
  private destroyed = false;

  constructor() {
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    this.realtime.events
      .pipe(
        filter(({ event, data }) => event === 'MATCH_FOUND' && typeof data['gameId'] === 'string'),
        takeUntilDestroyed(),
      )
      .subscribe(({ data }) => this.open(data['gameId'] as string));
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      clearInterval(this.heartbeat);
      // A join still in flight may land after this leave; its reply leaves again.
      if ((this.state() === 'waiting' || this.state() === 'joining') && !this.opened)
        this.leaveQuietly();
    });
    if (browser) this.resume();
  }

  /** After a reload: a search still waiting continues, a match still being played reopens. */
  resume(): void {
    this.api.status().subscribe({
      next: (status) => {
        if (status.status === 'WAITING') this.waiting(status.joinedAt);
        else if (status.status === 'MATCHED' && status.gameId) this.reopen(status.gameId);
      },
      error: () => {},
    });
  }

  start(timeControl: TimeControl): void {
    if (this.state() !== 'idle') return;
    this.state.set('joining');
    this.error.set(null);
    this.timeControl.set(timeControl);
    this.realtime.connect();
    this.api.join(timeControl).subscribe({
      next: ({ joinedAt }) => {
        if (this.destroyed) this.leaveQuietly();
        else this.waiting(joinedAt);
      },
      error: (error: unknown) => {
        if (this.destroyed) return;
        const code = error instanceof ApiError ? error.code : '';
        this.state.set('idle');
        if (code === 'ALREADY_IN_QUEUE') {
          this.resume();
          return;
        }
        this.error.set(JOIN_ERRORS[code] ?? 'The search could not start. Try again.');
      },
    });
  }

  cancel(): void {
    if (this.state() !== 'waiting') return;
    this.state.set('leaving');
    clearInterval(this.heartbeat);
    this.api.leave().subscribe({
      next: (status) => {
        // A match committed just before the cancel wins: the game exists and is played.
        if (status.status === 'MATCHED' && status.gameId) this.open(status.gameId);
        else this.stop();
      },
      error: () => {
        this.state.set('waiting');
        this.startHeartbeat();
        this.error.set('The search could not be cancelled. Try again.');
      },
    });
  }

  private waiting(joinedAt: string | undefined): void {
    if (this.destroyed) return;
    this.state.set('waiting');
    this.joinedAt.set(joinedAt ? Date.parse(joinedAt) : Date.now());
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    clearInterval(this.heartbeat);
    if (this.destroyed) return;
    this.heartbeat = setInterval(() => {
      this.api.heartbeat().subscribe({
        next: (status) => {
          if (this.destroyed || this.state() !== 'waiting') return;
          if (status.status === 'MATCHED' && status.gameId) this.open(status.gameId);
          else if (status.status !== 'WAITING') {
            // The lease ran out (a long sleep, a lost connection): the server cancelled it.
            clearInterval(this.heartbeat);
            this.stop();
            this.error.set('The search expired. Start a new one.');
          }
        },
        error: () => {},
      });
    }, MATCHMAKING_HEARTBEAT_MS);
  }

  private leaveQuietly(): void {
    this.api.leave().subscribe({ error: () => {} });
  }

  /** Only a game still in progress is reopened; an old match stays in the history. */
  private reopen(gameId: string): void {
    this.games.get(gameId).subscribe({
      next: (game) => {
        if (game.status === 'ACTIVE') this.open(gameId);
      },
      error: () => {},
    });
  }

  private open(gameId: string): void {
    if (this.opened || this.destroyed) return;
    this.opened = true;
    clearInterval(this.heartbeat);
    void this.router.navigate(['/game', gameId]);
  }

  private stop(): void {
    this.state.set('idle');
    this.joinedAt.set(null);
  }
}
