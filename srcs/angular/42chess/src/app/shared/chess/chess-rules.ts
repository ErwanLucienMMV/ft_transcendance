/**
 * Display-only chess rules: they decide what the board highlights and offers, never what is
 * legal. The server (C++ engine) stays authoritative and may still reject a move.
 */
export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PromotionType = 'q' | 'r' | 'b' | 'n';
export interface Piece {
  color: Color;
  type: PieceType;
}
export interface Position {
  /** 64 squares in FEN order: index 0 is a8, index 63 is h1. */
  board: (Piece | null)[];
  turn: Color;
  castling: string;
  enPassant: number | null;
  halfmove: number;
  fullmove: number;
}
export interface Move {
  from: string;
  to: string;
  promotion?: PromotionType;
}
export type PositionStatus = 'ongoing' | 'checkmate' | 'stalemate';

const FILES = 'abcdefgh';
const KNIGHT = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KING = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const ROOK = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const BISHOP = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const PROMOTIONS: PromotionType[] = ['q', 'r', 'b', 'n'];

export function squareName(index: number): string {
  return FILES[index % 8] + (8 - Math.floor(index / 8));
}

export function squareIndex(name: string): number {
  if (!/^[a-h][1-8]$/.test(name)) throw new Error(`Invalid square: ${name}`);
  return (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);
}

/** What is wrong with a FEN, so a page can say it in the player's language (`board.fen`). */
export type FenProblem =
  'fields' | 'ranks' | 'piece' | 'width' | 'kings' | 'turn' | 'castling' | 'enPassant' | 'counters';

export class FenError extends Error {
  constructor(
    readonly problem: FenProblem,
    message: string,
    /** The offending text, such as the unknown piece letter. */
    readonly value = '',
  ) {
    super(message);
  }
}

/** Throws on anything the board cannot draw safely; full legality is the server's job. */
export function parseFen(fen: string): Position {
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6) throw new FenError('fields', 'A FEN needs six fields.');
  const [placement, turn, castling, enPassant, halfmove, fullmove] = fields;
  const ranks = placement.split('/');
  if (ranks.length !== 8) throw new FenError('ranks', 'A FEN needs eight ranks.');
  const board: (Piece | null)[] = [];
  for (const rank of ranks) {
    let width = 0;
    for (const char of rank) {
      if (/[1-8]/.test(char)) {
        width += Number(char);
        board.push(...Array<null>(Number(char)).fill(null));
      } else if (/^[pnbrqk]$/i.test(char)) {
        width++;
        board.push({
          color: char === char.toUpperCase() ? 'w' : 'b',
          type: char.toLowerCase() as PieceType,
        });
      } else {
        throw new FenError('piece', `Invalid FEN piece: ${char}`, char);
      }
    }
    if (width !== 8) throw new FenError('width', 'Each FEN rank needs eight squares.');
  }
  for (const color of ['w', 'b'] as const) {
    if (board.filter((piece) => piece?.type === 'k' && piece.color === color).length !== 1)
      throw new FenError('kings', 'Each side needs exactly one king.');
  }
  if (turn !== 'w' && turn !== 'b') throw new FenError('turn', 'Invalid side to move.');
  if (!/^(-|K?Q?k?q?)$/.test(castling) || castling === '')
    throw new FenError('castling', 'Invalid castling field.');
  if (enPassant !== '-' && !new RegExp(`^[a-h]${turn === 'w' ? 6 : 3}$`).test(enPassant))
    throw new FenError('enPassant', 'Invalid en passant square.');
  if (!/^\d+$/.test(halfmove) || !/^[1-9]\d*$/.test(fullmove))
    throw new FenError('counters', 'Invalid move counters.');
  return {
    board,
    turn,
    castling: castling === '-' ? '' : castling,
    enPassant: enPassant === '-' ? null : squareIndex(enPassant),
    halfmove: Number(halfmove),
    fullmove: Number(fullmove),
  };
}

export function isInCheck(position: Position, color: Color = position.turn): boolean {
  const king = position.board.findIndex((piece) => piece?.type === 'k' && piece.color === color);
  return king >= 0 && attacked(position.board, king, other(color));
}

export function legalMoves(position: Position): Move[] {
  return pseudoMoves(position).filter(
    (move) => !isInCheck(applyMove(position, move), position.turn),
  );
}

export function positionStatus(position: Position): PositionStatus {
  if (legalMoves(position).length) return 'ongoing';
  return isInCheck(position) ? 'checkmate' : 'stalemate';
}

/** Plays a move without validating it; callers pass a move from legalMoves(). */
export function applyMove(position: Position, move: Move): Position {
  const from = squareIndex(move.from);
  const to = squareIndex(move.to);
  const board = [...position.board];
  const piece = board[from];
  if (!piece) throw new Error(`No piece on ${move.from}.`);
  const captured = board[to];
  board[from] = null;
  board[to] = move.promotion ? { color: piece.color, type: move.promotion } : piece;
  if (piece.type === 'p' && to === position.enPassant && !captured) {
    board[to + (piece.color === 'w' ? 8 : -8)] = null;
  }
  if (piece.type === 'k' && Math.abs(to - from) === 2) {
    const [rookFrom, rookTo] = to > from ? [from + 3, from + 1] : [from - 4, from - 1];
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }
  let castling = position.castling;
  const lost: Record<number, string> = { 60: 'KQ', 4: 'kq', 63: 'K', 56: 'Q', 7: 'k', 0: 'q' };
  for (const square of [from, to]) {
    for (const right of lost[square] ?? '') castling = castling.replace(right, '');
  }
  return {
    board,
    turn: other(position.turn),
    castling,
    enPassant: piece.type === 'p' && Math.abs(to - from) === 16 ? (from + to) / 2 : null,
    halfmove: piece.type === 'p' || captured ? 0 : position.halfmove + 1,
    fullmove: position.fullmove + (position.turn === 'b' ? 1 : 0),
  };
}

export function toFen(position: Position): string {
  const ranks: string[] = [];
  for (let rank = 0; rank < 8; rank++) {
    let text = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = position.board[rank * 8 + file];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) text += empty;
      empty = 0;
      text += piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
    }
    ranks.push(text + (empty || ''));
  }
  const enPassant = position.enPassant === null ? '-' : squareName(position.enPassant);
  return [
    ranks.join('/'),
    position.turn,
    position.castling || '-',
    enPassant,
    position.halfmove,
    position.fullmove,
  ].join(' ');
}

function other(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

function offset(index: number, file: number, rank: number): number | null {
  const f = (index % 8) + file;
  const r = Math.floor(index / 8) - rank;
  return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : null;
}

function attacked(board: (Piece | null)[], square: number, by: Color): boolean {
  const is = (index: number | null, ...types: PieceType[]) => {
    const piece = index === null ? null : board[index];
    return !!piece && piece.color === by && types.includes(piece.type);
  };
  // A white pawn attacks upwards, so it sits one rank below the attacked square.
  const pawnRank = by === 'w' ? -1 : 1;
  if (is(offset(square, -1, pawnRank), 'p') || is(offset(square, 1, pawnRank), 'p')) return true;
  if (KNIGHT.some(([f, r]) => is(offset(square, f, r), 'n'))) return true;
  if (KING.some(([f, r]) => is(offset(square, f, r), 'k'))) return true;
  const slides = (directions: number[][], types: PieceType[]) =>
    directions.some(([f, r]) => {
      for (let next = offset(square, f, r); next !== null; next = offset(next, f, r)) {
        if (board[next]) return is(next, ...types);
      }
      return false;
    });
  return slides(ROOK, ['r', 'q']) || slides(BISHOP, ['b', 'q']);
}

function pseudoMoves(position: Position): Move[] {
  const { board, turn } = position;
  const moves: Move[] = [];
  const add = (from: number, to: number) => {
    const piece = board[from]!;
    const lastRank = Math.floor(to / 8) === (turn === 'w' ? 0 : 7);
    if (piece.type === 'p' && lastRank) {
      for (const promotion of PROMOTIONS)
        moves.push({ from: squareName(from), to: squareName(to), promotion });
    } else {
      moves.push({ from: squareName(from), to: squareName(to) });
    }
  };
  board.forEach((piece, from) => {
    if (!piece || piece.color !== turn) return;
    if (piece.type === 'p') {
      const forward = turn === 'w' ? 1 : -1;
      const one = offset(from, 0, forward);
      if (one !== null && !board[one]) {
        add(from, one);
        const start = Math.floor(from / 8) === (turn === 'w' ? 6 : 1);
        const two = offset(from, 0, 2 * forward);
        if (start && two !== null && !board[two]) add(from, two);
      }
      for (const side of [-1, 1]) {
        const target = offset(from, side, forward);
        if (target === null) continue;
        const victim = board[target];
        if ((victim && victim.color !== turn) || target === position.enPassant) add(from, target);
      }
      return;
    }
    const steps = (directions: number[][], slide: boolean) => {
      for (const [f, r] of directions) {
        for (let to = offset(from, f, r); to !== null; to = offset(to, f, r)) {
          const victim = board[to];
          if (victim?.color === turn) break;
          add(from, to);
          if (victim || !slide) break;
        }
      }
    };
    if (piece.type === 'n') steps(KNIGHT, false);
    if (piece.type === 'b' || piece.type === 'q') steps(BISHOP, true);
    if (piece.type === 'r' || piece.type === 'q') steps(ROOK, true);
    if (piece.type === 'k') {
      steps(KING, false);
      castlingMoves(position, from).forEach((to) => add(from, to));
    }
  });
  return moves;
}

function castlingMoves(position: Position, king: number): number[] {
  const { board, turn, castling } = position;
  const home = turn === 'w' ? 60 : 4;
  if (king !== home || attacked(board, home, other(turn))) return [];
  const rook = (index: number) => board[index]?.type === 'r' && board[index]?.color === turn;
  const result: number[] = [];
  const [short, long] = turn === 'w' ? ['K', 'Q'] : ['k', 'q'];
  if (
    castling.includes(short) &&
    rook(home + 3) &&
    !board[home + 1] &&
    !board[home + 2] &&
    !attacked(board, home + 1, other(turn)) &&
    !attacked(board, home + 2, other(turn))
  )
    result.push(home + 2);
  if (
    castling.includes(long) &&
    rook(home - 4) &&
    !board[home - 1] &&
    !board[home - 2] &&
    !board[home - 3] &&
    !attacked(board, home - 1, other(turn)) &&
    !attacked(board, home - 2, other(turn))
  )
    result.push(home - 2);
  return result;
}

const SAN_LETTERS: Record<PieceType, string> = { p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

/**
 * Standard algebraic notation of a legal move ("Nbd7", "exd5", "O-O", "e8=Q#"), for the
 * analysis board and for a PGN of an old game whose moves were stored without it.
 */
export function sanOf(position: Position, move: Move): string {
  const from = squareIndex(move.from);
  const to = squareIndex(move.to);
  const piece = position.board[from];
  if (!piece) throw new Error(`No piece on ${move.from}.`);
  const after = applyMove(position, move);
  const suffix = isInCheck(after) ? (legalMoves(after).length ? '+' : '#') : '';
  if (piece.type === 'k' && Math.abs(to - from) === 2)
    return (to > from ? 'O-O' : 'O-O-O') + suffix;
  const capture = !!position.board[to] || (piece.type === 'p' && to === position.enPassant);
  let text = SAN_LETTERS[piece.type];
  if (piece.type === 'p') {
    if (capture) text = move.from[0];
  } else {
    // Another piece of the same kind that could also reach the square needs telling apart.
    const rivals = legalMoves(position).filter(
      (other) =>
        other.to === move.to &&
        other.from !== move.from &&
        position.board[squareIndex(other.from)]?.type === piece.type,
    );
    if (rivals.length) {
      const sameFile = rivals.some((other) => other.from[0] === move.from[0]);
      const sameRank = rivals.some((other) => other.from[1] === move.from[1]);
      text += !sameFile ? move.from[0] : !sameRank ? move.from[1] : move.from;
    }
  }
  if (capture) text += 'x';
  text += move.to;
  if (move.promotion) text += '=' + move.promotion.toUpperCase();
  return text + suffix;
}

/**
 * Squares a piece could reach once the opponent has moved, whatever they play: the shape of
 * its moves on an otherwise empty board, plus pawn captures and castling. A premove is only
 * played if it is legal when the turn comes.
 */
export function premoveTargets(position: Position, square: string): string[] {
  const from = squareIndex(square);
  const piece = position.board[from];
  if (!piece) return [];
  const targets = new Set<number>();
  const reach = (directions: number[][], slide: boolean) => {
    for (const [f, r] of directions)
      for (let to = offset(from, f, r); to !== null; to = slide ? offset(to, f, r) : null)
        targets.add(to);
  };
  if (piece.type === 'p') {
    const forward = piece.color === 'w' ? 1 : -1;
    const one = offset(from, 0, forward);
    if (one !== null) targets.add(one);
    const start = Math.floor(from / 8) === (piece.color === 'w' ? 6 : 1);
    const two = offset(from, 0, 2 * forward);
    if (start && two !== null) targets.add(two);
    for (const side of [-1, 1]) {
      const capture = offset(from, side, forward);
      if (capture !== null) targets.add(capture);
    }
  }
  if (piece.type === 'n') reach(KNIGHT, false);
  if (piece.type === 'b' || piece.type === 'q') reach(BISHOP, true);
  if (piece.type === 'r' || piece.type === 'q') reach(ROOK, true);
  if (piece.type === 'k') {
    reach(KING, false);
    const home = piece.color === 'w' ? 60 : 4;
    const [short, long] = piece.color === 'w' ? ['K', 'Q'] : ['k', 'q'];
    if (from === home && position.castling.includes(short)) targets.add(home + 2);
    if (from === home && position.castling.includes(long)) targets.add(home - 2);
  }
  // A square held by one of the player's own pieces is fine: the opponent may capture it.
  return [...targets].map(squareName);
}

const PIECE_VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FULL_SET: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
const CAPTURE_ORDER: PieceType[] = ['q', 'r', 'b', 'n', 'p'];

export interface Material {
  /** Pieces each side has taken from the other, most valuable first. */
  captured: Record<Color, PieceType[]>;
  /** Material balance in pawns: positive when White is ahead. */
  balance: number;
}

/**
 * Captured pieces read from a position: whatever is missing from a full set. A promoted
 * pawn counts as its new piece, so a side may show fewer captures than it made.
 */
export function material(position: Position): Material {
  const count = (color: Color, type: PieceType) =>
    position.board.filter((piece) => piece?.color === color && piece.type === type).length;
  const takenFrom = (color: Color) =>
    CAPTURE_ORDER.flatMap((type) =>
      Array<PieceType>(Math.max(0, FULL_SET[type] - count(color, type))).fill(type),
    );
  const value = (color: Color) =>
    position.board.reduce(
      (sum, piece) => sum + (piece?.color === color ? PIECE_VALUES[piece.type] : 0),
      0,
    );
  return {
    captured: { w: takenFrom('b'), b: takenFrom('w') },
    balance: value('w') - value('b'),
  };
}
