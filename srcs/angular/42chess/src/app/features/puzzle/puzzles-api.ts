import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';

export interface DailyPuzzle {
  id: string;
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
}
export interface PuzzleTurn extends PuzzleAttempt {
  correct: boolean;
  nextPosition?: string;
  /** UCI of the reply the server just played, never a future move. */
  opponentMove?: string;
}

@Injectable({ providedIn: 'root' })
export class PuzzlesApi {
  private readonly api = inject(ApiClient);

  daily(): Observable<DailyPuzzle> {
    return this.api.get('puzzles/daily');
  }

  start(puzzleId: string): Observable<PuzzleAttempt> {
    return this.api.post(`puzzles/${encodeURIComponent(puzzleId)}/attempts`, {});
  }

  attempt(attemptId: string): Observable<PuzzleAttempt> {
    return this.api.get(`puzzles/attempts/${encodeURIComponent(attemptId)}`);
  }

  play(attemptId: string, move: string, version: number): Observable<PuzzleTurn> {
    return this.api.post(`puzzles/attempts/${encodeURIComponent(attemptId)}/moves`, {
      move,
      version,
    });
  }
}

const PROGRESS_KEY = 'puzzle-attempt';
type Progress = { userId: string; puzzleId: string; attemptId: string };

/**
 * The attempt in progress, kept in this tab's sessionStorage so a reload resumes it. It holds
 * only identifiers: the server checks that the attempt belongs to the signed-in account.
 */
@Injectable({ providedIn: 'root' })
export class PuzzleProgress {
  find(userId: string, puzzleId: string): string | null {
    const current = this.read();
    return current?.userId === userId && current.puzzleId === puzzleId ? current.attemptId : null;
  }

  remember(userId: string, puzzleId: string, attemptId: string): void {
    try {
      sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ userId, puzzleId, attemptId }));
    } catch {
      // Storage can be unavailable (private mode, server rendering): progress stays on the server.
    }
  }

  forget(): void {
    try {
      sessionStorage.removeItem(PROGRESS_KEY);
    } catch {
      // Nothing was stored.
    }
  }

  private read(): Progress | null {
    try {
      const value = JSON.parse(sessionStorage.getItem(PROGRESS_KEY) ?? 'null') as Progress | null;
      return value && typeof value.attemptId === 'string' ? value : null;
    } catch {
      return null;
    }
  }
}
