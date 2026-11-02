import type { PuzzleMoveResponse, PuzzleTheme } from './puzzle.types.js';

export interface PuzzleSessionResponse {
  attemptId: string;
  puzzleId: string;
  fen: string;
  /** Accepted plies, including automatic opponent replies. */
  ply: number;
  /** Optimistic version; send it back with the next move. */
  version: number;
  completed: boolean;
  /** Number of submitted moves, including incorrect tries. */
  attempts: number;
  duration: number;
  /** Wrong moves so far, and how many more end the attempt. */
  mistakes: number;
  mistakesLeft: number;
  /** Ended unsolved: too many mistakes, or the solution was shown. */
  failed: boolean;
  hintUsed: boolean;
  revealed: boolean;
  /** Not the player's only attempt at this puzzle: it earns no XP and no streak. */
  practice: boolean;
}

export interface PuzzleTurnResponse
  extends PuzzleSessionResponse, PuzzleMoveResponse {
  /** Only the reply just played, never a future solution move. */
  opponentMove?: string;
  /** What solving this puzzle earned, when it counted. */
  reward?: { xp: number; streak: number | null };
}

export interface PuzzleProgressResponse {
  attempt: PuzzleSessionResponse | null;
  /** XP was already earned on this puzzle. */
  rewarded: boolean;
}

export interface PuzzleArchiveResponse {
  items: {
    date: string;
    id: string;
    rating: number;
    themes: PuzzleTheme[];
    status: 'SOLVED' | 'FAILED' | 'STARTED' | null;
  }[];
  total: number;
}
