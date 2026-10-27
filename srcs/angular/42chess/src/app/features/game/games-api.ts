import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type {
  BotDifficulty,
  GameMove,
  GamePlayer,
  GameSnapshot,
  PlayerColor,
} from '../../core/realtime/game-realtime';

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

export interface BotChoice {
  difficulty: BotDifficulty;
  label: string;
  description: string;
}
/** Search limits come from srcs/bot/README.md; the backend owns the real settings. */
export const BOT_LEVELS: readonly BotChoice[] = [
  { difficulty: 'EASY', label: 'Easy', description: 'Looks one move ahead. Good to learn.' },
  { difficulty: 'MEDIUM', label: 'Medium', description: 'Looks three moves ahead.' },
  {
    difficulty: 'HARD',
    label: 'Hard',
    description: 'Looks five moves ahead and spots short mates.',
  },
];

/** A REST game view has no move list; the realtime snapshot adds it. */
export type GameView = Omit<GameSnapshot, 'gameId' | 'moves'>;

/** One finished game, seen from the requested player's seat. */
export interface GameHistoryItem {
  id: string;
  color: PlayerColor;
  opponent: GamePlayer;
  outcome: 'WIN' | 'LOSS' | 'DRAW';
  reason: string | null;
  timeControl: TimeControl;
  moveCount: number;
  startedAt: string;
  endedAt: string;
}
/** The backend's PaginatedResponse. */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** REST side of games: creation, reads and history. Play goes through the WebSocket. */
@Injectable({ providedIn: 'root' })
export class GamesApi {
  private readonly api = inject(ApiClient);

  create(timeControl: TimeControl): Observable<{ gameId: string; status: 'WAITING' }> {
    return this.api.post('games', { timeControl });
  }

  createBot(game: {
    difficulty: BotDifficulty;
    color: PlayerColor;
    timeControl: TimeControl;
  }): Observable<GameView & { gameId: string }> {
    return this.api.post('games/bot', game);
  }

  /** Asks the server to retry a bot turn that failed; the room then receives the move. */
  resumeBot(id: string): Observable<GameView> {
    return this.api.post(`games/${encodeURIComponent(id)}/bot-move`, {});
  }

  get(id: string): Observable<GameView> {
    return this.api.get(`games/${encodeURIComponent(id)}`);
  }

  moves(id: string): Observable<{ moves: GameMove[] }> {
    return this.api.get(`games/${encodeURIComponent(id)}/moves`);
  }

  /** Finished games of a player, newest first. */
  history(userId: string, limit: number, offset: number): Observable<Page<GameHistoryItem>> {
    return this.api.get(`users/${encodeURIComponent(userId)}/games`, {
      params: { limit, offset },
    });
  }
}
