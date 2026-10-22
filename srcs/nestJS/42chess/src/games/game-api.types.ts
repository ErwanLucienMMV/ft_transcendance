import type {
  CollectionResponse,
  ISODateString,
  UUID,
} from '../common/types/api.js';
import type { PlayerColor, TimeControl } from './clock/game-clock.js';
import type { GameEndReason, GameStatus } from './game.entity.js';

export interface PlayerRef {
  id: UUID;
  username: string;
  avatarUrl: string | null;
  elo: number | null;
  color: PlayerColor;
  botDifficulty?: import('../bots/bot-engine.js').BotDifficulty;
}
export type PromotionPiece = 'QUEEN' | 'ROOK' | 'BISHOP' | 'KNIGHT';
export interface GameResponse {
  botPending: boolean;
  botThinking: boolean;
  botError: 'BOT_UNAVAILABLE' | 'INVALID_BOT_RESPONSE' | null;
  id: UUID;
  status: GameStatus;
  whitePlayer: PlayerRef | null;
  blackPlayer: PlayerRef | null;
  timeControl: TimeControl;
  board: {
    fen: string;
    turn: PlayerColor;
    halfmoveClock: number;
    fullmoveNumber: number;
  };
  // A pre-clock historical record has unknown balances, never fabricated ones.
  clocks: { white: number; black: number } | null;
  result: { winner: PlayerColor | null; reason: GameEndReason | null } | null;
  drawOffer: { playerId: UUID } | null;
  startedAt: ISODateString | null;
  endedAt: ISODateString | null;
  createdAt: ISODateString;
}
export interface MoveResponse {
  number: number;
  playerId: UUID;
  from: string;
  to: string;
  promotion?: PromotionPiece;
  /** Older UCI-only rows lack SAN; null is explicit until they are backfilled. */
  notation: string | null;
  fen: string;
  timestamp: ISODateString;
}
export type GameMovesResponse = CollectionResponse<'moves', MoveResponse>;
