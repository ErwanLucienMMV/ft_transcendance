import type { ChessEngineService } from '../chess/chess-engine.service.js';
import { assertFen } from '../chess/fen.js';
import { algebraicMove } from '../games/game-notation.js';
import { PUZZLE_THEMES } from './puzzle.types.js';
import type { Puzzle } from './puzzle.types.js';
import type { ChessMove } from '../common/types/chess.js';

export function puzzleMoveUci(move: ChessMove): string {
  if (
    !/^[a-h][1-8]$/.test(move.from) ||
    !/^[a-h][1-8]$/.test(move.to) ||
    move.from === move.to
  )
    throw new Error('Invalid puzzle move squares');
  const promotions: Partial<
    Record<NonNullable<ChessMove['promotion']>, string>
  > = { QUEEN: 'q', ROOK: 'r', BISHOP: 'b', KNIGHT: 'n' };
  if (move.promotion && !promotions[move.promotion])
    throw new Error('Invalid puzzle promotion');
  return (
    move.from + move.to + (move.promotion ? promotions[move.promotion] : '')
  );
}
/** Imported/generated puzzles must pass this before persistence; FEN alone is not a solution. */
export async function validatePuzzle(
  puzzle: Puzzle,
  engine: Pick<ChessEngineService, 'analyze'>,
): Promise<void> {
  assertFen(puzzle.fen);
  if (
    !Number.isSafeInteger(puzzle.rating) ||
    puzzle.rating < 0 ||
    !puzzle.solution.length
  )
    throw new Error('Invalid puzzle rating or empty solution');
  if (puzzle.themes.some((theme) => !PUZZLE_THEMES.includes(theme)))
    throw new Error('Unknown puzzle theme');
  let before = await engine.analyze({ fen: puzzle.fen });
  if (before.status !== 'ongoing')
    throw new Error('Puzzle must start in a playable position');
  const solverColor = before.turn;
  if (
    (puzzle.themes.includes('MATE_IN_ONE') && puzzle.solution.length !== 1) ||
    (puzzle.themes.includes('MATE_IN_TWO') && puzzle.solution.length !== 3)
  )
    throw new Error('Mate theme does not match solution length');
  const moves: string[] = [];
  for (const move of puzzle.solution) {
    if (
      !(move.timestamp instanceof Date) ||
      !Number.isFinite(move.timestamp.getTime()) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        move.playerId,
      )
    )
      throw new Error(
        'Puzzle move requires real metadata or explicit fixture metadata',
      );
    const uci = puzzleMoveUci(move);
    if (!before.legalMoves.includes(uci))
      throw new Error('Puzzle solution contains an illegal move');
    moves.push(uci);
    const after = await engine.analyze({ fen: puzzle.fen, moves });
    if (move.notation !== algebraicMove(before, after, uci))
      throw new Error('Puzzle SAN does not match its move');
    before = after;
  }
  if (
    (puzzle.themes.includes('MATE_IN_ONE') ||
      puzzle.themes.includes('MATE_IN_TWO') ||
      puzzle.themes.includes('CHECKMATE')) &&
    (!before.checkmate || before.winner !== solverColor)
  )
    throw new Error('Mate puzzle solution must end in checkmate');
}
