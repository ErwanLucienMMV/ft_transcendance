import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { GameSnapshot } from '../../core/realtime/game-realtime';

/** Milliseconds, as the server stores them. */
export interface TimeControl {
  initialTime: number;
  increment: number;
}
export interface TimeControlChoice extends TimeControl {
  label: string;
  category: string;
}
export const TIME_CONTROLS: readonly TimeControlChoice[] = [
  { label: '3 + 2', category: 'Blitz', initialTime: 180_000, increment: 2_000 },
  { label: '5 + 0', category: 'Blitz', initialTime: 300_000, increment: 0 },
  { label: '10 + 0', category: 'Rapid', initialTime: 600_000, increment: 0 },
  { label: '15 + 10', category: 'Rapid', initialTime: 900_000, increment: 10_000 },
  { label: '30 + 0', category: 'Classical', initialTime: 1_800_000, increment: 0 },
];

/** A REST game view has no move list; the realtime snapshot adds it. */
export type GameView = Omit<GameSnapshot, 'gameId' | 'moves'>;

/** REST side of games: creation and a read-only fallback. Play goes through the WebSocket. */
@Injectable({ providedIn: 'root' })
export class GamesApi {
  private readonly api = inject(ApiClient);

  create(timeControl: TimeControl): Observable<{ gameId: string; status: 'WAITING' }> {
    return this.api.post('games', { timeControl });
  }

  get(id: string): Observable<GameView> {
    return this.api.get(`games/${encodeURIComponent(id)}`);
  }
}
