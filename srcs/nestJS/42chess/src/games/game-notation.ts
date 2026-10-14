import type { ChessSnapshot } from '../chess/chess-engine.service.js';
import { GameError } from './game-error.js';

/** Formats SAN only for an engine-confirmed legal move; this does not implement rules. */
export function algebraicMove(
  before: ChessSnapshot,
  after: ChessSnapshot,
  uci: string,
): string {
  const board = fenPieces(before.fen);
  const from = uci.slice(0, 2),
    to = uci.slice(2, 4),
    piece = board.get(from);
  if (!piece || !before.legalMoves.includes(uci))
    throw new GameError(
      'INVALID_GAME_HISTORY',
      'Notation requires an engine-confirmed legal move.',
    );
  const type = piece.toUpperCase();
  const suffix = after.checkmate ? '#' : after.check ? '+' : '';
  if (type === 'K' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2)
    return (to[0] === 'g' ? 'O-O' : 'O-O-O') + suffix;
  const capture = board.has(to) || (type === 'P' && from[0] !== to[0]);
  let prefix = type === 'P' ? (capture ? from[0] : '') : type;
  if (type !== 'P') {
    const alternatives = before.legalMoves.filter(
      (move) =>
        move.slice(2, 4) === to &&
        move.slice(0, 2) !== from &&
        board.get(move.slice(0, 2)) === piece,
    );
    if (alternatives.length)
      prefix += !alternatives.some((move) => move[0] === from[0])
        ? from[0]
        : !alternatives.some((move) => move[1] === from[1])
          ? from[1]
          : from;
  }
  return (
    prefix +
    (capture ? 'x' : '') +
    to +
    (uci.length === 5 ? '=' + uci[4].toUpperCase() : '') +
    suffix
  );
}

function fenPieces(fen: string): Map<string, string> {
  const board = new Map<string, string>();
  for (const [rank, row] of fen.split(' ')[0].split('/').entries()) {
    let file = 0;
    for (const token of row) {
      if (/[1-8]/.test(token)) file += Number(token);
      else {
        board.set(String.fromCharCode(97 + file) + (8 - rank), token);
        file++;
      }
    }
  }
  return board;
}
