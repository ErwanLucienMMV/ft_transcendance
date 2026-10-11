import type { ChessSnapshot } from '../chess/chess-engine.service.js';
import { GameError } from './game-error.js';
import { isFen } from './game-input.js';

/** The transport returns JSON; TypeScript declarations alone cannot validate it. */
export function checkedSnapshot(value: unknown): ChessSnapshot {
  if (!value || typeof value !== 'object') return invalid();
  const s = value as Record<string, unknown>;
  if (
    !isFen(s.fen) ||
    !['white', 'black'].includes(s.turn as string) ||
    s.fen.split(' ')[1] !== (s.turn === 'white' ? 'w' : 'b') ||
    ![
      'check',
      'checkmate',
      'stalemate',
      'insufficientMaterial',
      'threefoldClaimable',
      'fiftyMoveClaimable',
    ].every((key) => typeof s[key] === 'boolean') ||
    !Number.isSafeInteger(s.repetitionCount) ||
    (s.repetitionCount as number) < 1 ||
    !Array.isArray(s.legalMoves) ||
    s.legalMoves.some(
      (move) =>
        typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move),
    )
  ) {
    return invalid();
  }
  const status = s.checkmate
    ? 'checkmate'
    : s.stalemate
      ? 'stalemate'
      : s.insufficientMaterial
        ? 'insufficient_material'
        : 'ongoing';
  const winner = s.checkmate ? (s.turn === 'white' ? 'black' : 'white') : null;
  if (
    s.status !== status ||
    s.winner !== winner ||
    s.checkmate !== (s.check && s.legalMoves.length === 0) ||
    s.stalemate !== (!s.check && s.legalMoves.length === 0) ||
    s.threefoldClaimable !== (s.repetitionCount as number) >= 3 ||
    s.fiftyMoveClaimable !== BigInt(s.fen.split(' ')[4]) >= 100n
  )
    return invalid();
  return value as ChessSnapshot;
}

export function checkedValidation(value: unknown): {
  legal: boolean;
  fen: string;
} {
  if (!value || typeof value !== 'object') return invalid();
  const v = value as Record<string, unknown>;
  if (typeof v.legal !== 'boolean' || !isFen(v.fen)) return invalid();
  return value as { legal: boolean; fen: string };
}

function invalid(): never {
  throw new GameError(
    'INVALID_ENGINE_RESPONSE',
    'The rules engine returned an inconsistent response.',
  );
}
