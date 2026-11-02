import type {
  BotDifficulty,
  GameMove,
  GamePlayer,
  GameResult,
  PlayerColor,
} from '../../core/realtime/game-realtime';

/** Standard start: games are created from it, and a replay starts from it. */
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Server end reasons, worded to follow "White wins" or "Draw". */
const END_REASONS: Record<string, string> = {
  CHECKMATE: 'by checkmate',
  RESIGNATION: 'by resignation',
  TIMEOUT: 'on time',
  DRAW_AGREEMENT: 'by agreement',
  STALEMATE: 'by stalemate',
  INSUFFICIENT_MATERIAL: 'by insufficient material',
  THREEFOLD_REPETITION: 'by threefold repetition',
  FIFTY_MOVE_RULE: 'by the fifty-move rule',
  FIVEFOLD_REPETITION: 'by fivefold repetition',
  SEVENTY_FIVE_MOVE_RULE: 'by the seventy-five-move rule',
  ABANDONED: 'by abandonment',
};
const BOT_NAMES: Record<BotDifficulty, string> = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' };

export function endReason(reason: string | null | undefined): string | null {
  return reason ? (END_REASONS[reason] ?? null) : null;
}

/** "White wins by checkmate", "Draw by agreement"; `mine` turns it into "You won…". */
export function resultText(result: GameResult, mine: PlayerColor | null = null): string {
  if (result.reason === 'ABORTED') return 'Game aborted';
  // The flag fell, but the opponent had nothing left to checkmate with.
  if (result.reason === 'TIMEOUT' && !result.winner)
    return 'Draw: time ran out against insufficient material';
  const reason = endReason(result.reason);
  const suffix = reason ? ` ${reason}` : '';
  if (!result.winner) return `Draw${suffix}`;
  if (mine) return `${result.winner === mine ? 'You won' : 'You lost'}${suffix}`;
  return `${result.winner === 'WHITE' ? 'White' : 'Black'} wins${suffix}`;
}

const OUTCOMES = { WIN: 'Won', LOSS: 'Lost', DRAW: 'Draw' } as const;

/** One word for a finished game seen from a player's seat: "Won", "Lost" or "Draw". */
export function outcomeText(outcome: keyof typeof OUTCOMES): string {
  return OUTCOMES[outcome];
}

export function botName(difficulty: BotDifficulty): string {
  return `Computer · ${BOT_NAMES[difficulty]}`;
}

/** "rival (1216)", or the bot level; the rating is left out when there is none. */
export function playerLabel(player: GamePlayer | null): string {
  if (!player) return 'Unknown player';
  if (player.botDifficulty) return botName(player.botDifficulty);
  return player.elo === null ? player.username : `${player.username} (${player.elo})`;
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
