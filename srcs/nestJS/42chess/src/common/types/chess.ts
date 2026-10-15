import type { UUID } from './api.js';

/** Proposition spec.md §6.2, §6.3 and §12: domain values, before JSON serialization. */
export type ChessColor = 'WHITE' | 'BLACK';
export type PieceType =
  'PAWN' | 'KNIGHT' | 'BISHOP' | 'ROOK' | 'QUEEN' | 'KING';
export type Square =
  `${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h'}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export interface ChessMove {
  from: Square;
  to: Square;
  promotion?: PieceType;
  notation: string;
  timestamp: Date;
  playerId: UUID;
}
