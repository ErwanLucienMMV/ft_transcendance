import type { UUID, ISODateString } from '../common/types/api.js';
import type { ChessMove } from '../common/types/chess.js';

export const PUZZLE_THEMES = [
  'CHECK',
  'CHECKMATE',
  'FORK',
  'PIN',
  'SKEWER',
  'DISCOVERED_ATTACK',
  'MATE_IN_ONE',
  'MATE_IN_TWO',
] as const;
export type PuzzleTheme = (typeof PUZZLE_THEMES)[number];
/** Spec §31. Kept separate from the legacy UCI persistence representation. */
export interface Puzzle {
  id: UUID;
  fen: string;
  solution: ChessMove[];
  rating: number;
  themes: PuzzleTheme[];
  createdAt: Date;
}
export interface DailyPuzzle {
  date: string;
  puzzleId: UUID;
}
/** Spec §33; duration is measured in milliseconds, like other app durations. */
export interface PuzzleAttempt {
  id: UUID;
  userId: UUID;
  puzzleId: UUID;
  solved: boolean;
  attempts: number;
  duration: number;
  createdAt: Date;
}
/** Spec §30: solutions and internal relations are deliberately absent. */
export interface DailyPuzzleResponse {
  id: UUID;
  date: string;
  rating: number;
  fen: string;
  themes: PuzzleTheme[];
}
export interface PuzzleMoveResponse {
  correct: boolean;
  completed: boolean;
  nextPosition?: string;
}
export type SerializedPuzzleMove = Omit<ChessMove, 'timestamp'> & {
  timestamp: ISODateString;
};
