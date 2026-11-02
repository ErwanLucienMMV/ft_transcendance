import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { handledErrors } from '../../core/api/api-error.interceptor';

// The puzzle page explains these codes itself (see ERRORS in puzzle-page.ts).
const ATTEMPT_ERRORS = handledErrors(
  'PUZZLE_ENGINE_UNAVAILABLE',
  'LEGACY_PUZZLE_ATTEMPT',
  'PUZZLE_ATTEMPT_FAILED',
  'PUZZLE_ALREADY_COMPLETED',
  'PUZZLE_NOT_FOUND',
);

export interface DailyPuzzle {
  id: string;
  /** The day it was (or is) the daily puzzle, YYYY-MM-DD in UTC. */
  date: string;
  rating: number;
  fen: string;
  themes: string[];
}
/** The server never sends the solution: only the position after each accepted move. */
export interface PuzzleAttempt {
  attemptId: string;
  puzzleId: string;
  fen: string;
  ply: number;
  version: number;
  completed: boolean;
  attempts: number;
  /** Milliseconds from the start of the attempt to the last move sent. */
  duration: number;
  mistakes: number;
  mistakesLeft: number;
  /** Ended unsolved: too many mistakes, or the solution was shown. */
  failed: boolean;
  hintUsed: boolean;
  revealed: boolean;
  /** Not the player's only attempt at this puzzle: it earns nothing. */
  practice: boolean;
}
export interface PuzzleReward {
  xp: number;
  /** Daily streak after this puzzle; null for an earlier day's puzzle. */
  streak: number | null;
}
export interface PuzzleTurn extends PuzzleAttempt {
  correct: boolean;
  nextPosition?: string;
  /** UCI of the reply the server just played, never a future move. */
  opponentMove?: string;
  reward?: PuzzleReward;
}
export interface ArchivedPuzzle {
  id: string;
  date: string;
  rating: number;
  themes: string[];
  status: 'SOLVED' | 'FAILED' | 'STARTED' | null;
}

export const ARCHIVE_PAGE = 20;

@Injectable({ providedIn: 'root' })
export class PuzzlesApi {
  private readonly api = inject(ApiClient);

  daily(): Observable<DailyPuzzle> {
    return this.api.get('puzzles/daily', handledErrors('PUZZLE_CATALOG_EMPTY'));
  }

  /** A puzzle of today or an earlier day. */
  published(puzzleId: string): Observable<DailyPuzzle> {
    return this.api.get(`puzzles/${encodeURIComponent(puzzleId)}`, ATTEMPT_ERRORS);
  }

  /** The player's latest attempt at this puzzle, wherever it was started. */
  progress(puzzleId: string): Observable<{ attempt: PuzzleAttempt | null; rewarded: boolean }> {
    return this.api.get(`puzzles/${encodeURIComponent(puzzleId)}/progress`);
  }

  archive(
    offset: number,
    limit = ARCHIVE_PAGE,
  ): Observable<{ items: ArchivedPuzzle[]; total: number }> {
    return this.api.get('puzzles/archive', { params: { limit, offset } });
  }

  start(puzzleId: string): Observable<PuzzleAttempt> {
    return this.api.post(`puzzles/${encodeURIComponent(puzzleId)}/attempts`, {}, ATTEMPT_ERRORS);
  }

  attempt(attemptId: string): Observable<PuzzleAttempt> {
    return this.api.get(`puzzles/attempts/${encodeURIComponent(attemptId)}`, ATTEMPT_ERRORS);
  }

  play(attemptId: string, move: string, version: number): Observable<PuzzleTurn> {
    return this.api.post(
      `puzzles/attempts/${encodeURIComponent(attemptId)}/moves`,
      { move, version },
      ATTEMPT_ERRORS,
    );
  }

  /** The square of the piece to move; the attempt then earns half the XP. */
  hint(attemptId: string): Observable<PuzzleAttempt & { hint: string }> {
    return this.api.post(
      `puzzles/attempts/${encodeURIComponent(attemptId)}/hint`,
      {},
      ATTEMPT_ERRORS,
    );
  }

  /** The whole line from the published position. An unsolved attempt ends there. */
  solution(attemptId: string): Observable<PuzzleAttempt & { solution: string[] }> {
    return this.api.post(
      `puzzles/attempts/${encodeURIComponent(attemptId)}/solution`,
      {},
      ATTEMPT_ERRORS,
    );
  }
}
