import { assertFen } from '../chess/fen.js';
import { puzzleMoveUci } from './puzzle-validation.js';
import type { Puzzle as StoredPuzzle } from './puzzles.entity.js';
import type { PuzzleAttempt as StoredAttempt } from './puzzle-attempts.entity.js';
import type { DailyPuzzle as StoredDaily } from './daily-puzzles.entity.js';
import type {
  Puzzle,
  PuzzleAttempt,
  DailyPuzzleResponse,
} from './puzzle.types.js';

export function toPuzzle(row: StoredPuzzle): Puzzle {
  assertFen(row.fen);
  if (!row.solutionMoves || row.themes === null || row.themes === undefined) {
    throw new Error(
      'Legacy puzzle requires explicit solution metadata and theme backfill',
    );
  }
  if (
    row.solution &&
    (row.solution.length !== row.solutionMoves.length ||
      row.solution.some(
        (uci, index) => uci !== puzzleMoveUci(row.solutionMoves![index]),
      ))
  )
    throw new Error('Puzzle UCI and detailed solutions disagree');
  return {
    id: row.id,
    fen: row.fen,
    solution: row.solutionMoves.map((move) => ({
      ...move,
      timestamp: new Date(move.timestamp),
    })),
    rating: row.rating,
    themes: [...row.themes],
    createdAt: row.createdAt,
  };
}
export function toPuzzleAttempt(row: StoredAttempt): PuzzleAttempt {
  if (
    row.attempts === null ||
    row.attempts === undefined ||
    row.duration === null ||
    row.duration === undefined
  )
    throw new Error('Legacy puzzle attempt has unknown metrics');
  return {
    id: row.id,
    userId: row.userId,
    puzzleId: row.puzzleId,
    solved: row.solved,
    attempts: row.attempts,
    duration: row.duration,
    createdAt: row.createdAt,
  };
}
export function toDailyPuzzleResponse(
  daily: StoredDaily,
  row: StoredPuzzle,
): DailyPuzzleResponse {
  if (daily.puzzleId !== row.id)
    throw new Error('Daily puzzle relation does not match');
  assertFen(row.fen);
  if (row.themes === null || row.themes === undefined)
    throw new Error('Legacy puzzle requires explicit theme backfill');
  return {
    id: row.id,
    date: daily.date,
    rating: row.rating,
    fen: row.fen,
    themes: [...row.themes],
  };
}
