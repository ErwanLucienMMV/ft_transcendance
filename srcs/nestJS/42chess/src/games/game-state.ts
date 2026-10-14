import type { Game } from './game.entity.js';
import type { GamePlayer } from './game-player.entity.js';
import type { Move } from './move.entity.js';
import type { PlayerColor } from './clock/game-clock.js';

export interface GameState {
  game: Game;
  players: GamePlayer[];
  moves: Move[];
}

export interface CreateGameInput {
  initialTime: number;
  increment?: number;
  color?: PlayerColor;
  initialFen?: string;
  opponentId?: string | null;
}

export type DrawClaim = 'THREEFOLD_REPETITION' | 'FIFTY_MOVE';
