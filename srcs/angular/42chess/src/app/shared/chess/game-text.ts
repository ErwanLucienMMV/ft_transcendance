import type {
  BotDifficulty,
  GameMove,
  GamePlayer,
  GameResult,
  PlayerColor,
} from '../../core/realtime/game-realtime';
import { tr, TranslationKey, trIfExists } from '../../core/i18n/i18n';

/** Standard start: games are created from it, and a replay starts from it. */
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Server end reasons, worded to follow "White wins" or "Draw" (`chess.reasons`). */
export function endReason(reason: string | null | undefined): string | null {
  return reason ? trIfExists(`chess.reasons.${reason}` as TranslationKey) : null;
}

/** "White wins by checkmate", "Draw by agreement"; `mine` turns it into "You won…". */
export function resultText(result: GameResult, mine: PlayerColor | null = null): string {
  if (result.reason === 'ABORTED') return tr('chess.result.aborted');
  // The flag fell, but the opponent had nothing left to checkmate with.
  if (result.reason === 'TIMEOUT' && !result.winner) return tr('chess.result.timeoutDraw');
  const reason = endReason(result.reason);
  const outcome = !result.winner
    ? tr('chess.result.draw')
    : mine
      ? tr(result.winner === mine ? 'chess.result.youWon' : 'chess.result.youLost')
      : tr(result.winner === 'WHITE' ? 'chess.result.whiteWins' : 'chess.result.blackWins');
  return reason ? tr('chess.result.withReason', { outcome, reason }) : outcome;
}

/** One word for a finished game seen from a player's seat: "Won", "Lost" or "Draw". */
export function outcomeText(outcome: 'WIN' | 'LOSS' | 'DRAW'): string {
  return tr(`chess.outcomes.${outcome}`);
}

/** "Easy", "Medium" or "Hard". */
export function botLevel(difficulty: BotDifficulty): string {
  return tr(`chess.bots.${difficulty}`);
}

export function botName(difficulty: BotDifficulty): string {
  return tr('chess.bot', { level: botLevel(difficulty) });
}

/** "rival (1216)", or the bot level; the rating is left out when there is none. */
/** Deleted accounts keep their games under an anonymous `deleted_<hex>` name. */
export function displayName(username: string): string {
  return username.startsWith('deleted_') ? tr('common.deletedPlayer') : username;
}

export function playerLabel(player: GamePlayer | null): string {
  if (!player) return tr('common.unknownPlayer');
  if (player.botDifficulty) return botName(player.botDifficulty);
  const name = displayName(player.username);
  return player.elo === null || name !== player.username ? name : `${name} (${player.elo})`;
}

/** The colour a user plays in a game, or null when they are not seated. */
export function seatOf(
  game: { whitePlayer: GamePlayer | null; blackPlayer: GamePlayer | null } | null,
  userId: string | null | undefined,
): PlayerColor | null {
  if (!game || !userId) return null;
  if (game.whitePlayer?.id === userId) return 'WHITE';
  return game.blackPlayer?.id === userId ? 'BLACK' : null;
}

export interface MoveRow {
  number: number;
  white: { text: string; ply: number } | null;
  black: { text: string; ply: number } | null;
}

/** Pairs plies into numbered rows; ply 1 is White's first move. */
export function moveRows(moves: readonly GameMove[]): MoveRow[] {
  const rows: MoveRow[] = [];
  for (const move of moves) {
    const cell = { text: move.notation ?? `${move.from}-${move.to}`, ply: move.number };
    if (move.number % 2 === 1)
      rows.push({ number: (move.number + 1) / 2, white: cell, black: null });
    else if (rows.length) rows[rows.length - 1].black = cell;
    else rows.push({ number: move.number / 2, white: null, black: cell });
  }
  return rows;
}

/** The part of a FEN that identifies a position for repetition: pieces, side, castling, en passant. */
function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/** How many times the current position occurred, counting the starting one. */
export function repetitions(initialFen: string, moves: readonly GameMove[]): number {
  const fens = [initialFen, ...moves.map((move) => move.fen)];
  const current = positionKey(fens[fens.length - 1]);
  return fens.filter((fen) => positionKey(fen) === current).length;
}

/**
 * A move as a screen reader should say it: "White: Knight takes e5, check" rather than
 * "N x e 5 plus".
 */
export function spokenMove(notation: string, color: PlayerColor): string {
  const side = tr(color === 'WHITE' ? 'common.white' : 'common.black');
  const line = (move: string) => tr('chess.spoken.line', { side, move });
  const suffix = notation.endsWith('#')
    ? tr('chess.spoken.checkmate')
    : notation.endsWith('+')
      ? tr('chess.spoken.check')
      : '';
  const san = notation.replace(/[+#!?]+$/, '');
  if (san.startsWith('O-O-O')) return line(tr('chess.spoken.queenside') + suffix);
  if (san.startsWith('O-O')) return line(tr('chess.spoken.kingside') + suffix);
  const match = /^([KQRBN])?([a-h]?[1-8]?)(x)?([a-h][1-8])(?:=([QRBN]))?$/.exec(san);
  if (!match) return line(notation);
  const [, piece, from, capture, to, promotion] = match as unknown as [
    string,
    SpokenPiece | undefined,
    string,
    string | undefined,
    string,
    SpokenPiece | undefined,
  ];
  const mover = piece
    ? tr(`chess.spoken.pieces.${piece}`)
    : from
      ? tr('chess.spoken.pawnOf', { file: from })
      : tr('chess.spoken.pieces.P');
  const origin = piece && from ? tr('chess.spoken.from', { square: from }) : '';
  const promoted = promotion
    ? tr('chess.spoken.promotes', { piece: tr(`chess.spoken.pieces.${promotion}`).toLowerCase() })
    : '';
  const verb = tr(capture ? 'chess.spoken.takes' : 'chess.spoken.to');
  return line(`${mover}${origin} ${verb} ${to}${promoted}${suffix}`);
}

type SpokenPiece = 'K' | 'Q' | 'R' | 'B' | 'N';
