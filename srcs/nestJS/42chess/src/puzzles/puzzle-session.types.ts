import type { PuzzleMoveResponse } from './puzzle.types.js';

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
}

export interface PuzzleTurnResponse
  extends PuzzleSessionResponse, PuzzleMoveResponse {
  /** Only the reply just played, never a future solution move. */
  opponentMove?: string;
}
