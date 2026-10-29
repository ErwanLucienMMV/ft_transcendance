import { Component, computed, input, linkedSignal, output } from '@angular/core';
import type { PlayerColor, Promotion } from '../../core/realtime/game-realtime';
import {
  applyMove,
  isInCheck,
  legalMoves,
  Move,
  parseFen,
  PieceType,
  Position,
  positionStatus,
  PromotionType,
  squareIndex,
  squareName,
  toFen,
} from './chess-rules';
import { resultText } from './game-text';

export interface BoardMove {
  from: string;
  to: string;
  promotion: Promotion | null;
}
export interface BoardResult {
  winner: PlayerColor | null;
  reason: string | null;
}
interface BoardSquare {
  name: string;
  dark: boolean;
  piece: { color: 'white' | 'black'; name: string } | null;
  fileLabel: string | null;
  rankLabel: string | null;
}

const PIECE_NAMES: Record<PieceType, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};
const PROMOTION_NAMES: Record<PromotionType, Promotion> = {
  q: 'QUEEN',
  r: 'ROOK',
  b: 'BISHOP',
  n: 'KNIGHT',
};
const PROMOTION_LETTERS: Record<Promotion, PromotionType> = {
  QUEEN: 'q',
  ROOK: 'r',
  BISHOP: 'b',
  KNIGHT: 'n',
};

/** UCI text of a board move, as the puzzle API and the bot engine expect it. */
export function moveUci(move: BoardMove): string {
  return move.from + move.to + (move.promotion ? PROMOTION_LETTERS[move.promotion] : '');
}

/** The position after a board move, for a local board or a preview; it throws on a bad FEN. */
export function fenAfter(fen: string, move: BoardMove): string {
  return toFen(
    applyMove(parseFen(fen), {
      from: move.from,
      to: move.to,
      promotion: move.promotion ? PROMOTION_LETTERS[move.promotion] : undefined,
    }),
  );
}

/**
 * Renders a FEN and proposes moves. It never plays them: the parent sends `moved` to the
 * server and passes the confirmed FEN back, so a rejected move simply leaves the board as is.
 */
@Component({
  selector: 'app-chess-board',
  templateUrl: './chess-board.html',
  styleUrl: './chess-board.css',
  host: { '(keydown.escape)': 'cancel()' },
})
export class ChessBoard {
  readonly fen = input.required<string>();
  readonly orientation = input<PlayerColor>('WHITE');
  readonly lastMove = input<{ from: string; to: string } | null>(null);
  readonly interactive = input(false);
  /** The colour this viewer may move; null lets whoever is to move play (analysis board). */
  readonly playerColor = input<PlayerColor | null>(null);
  /** The server's verdict wins over the locally detected checkmate or stalemate. */
  readonly result = input<BoardResult | null>(null);
  readonly moved = output<BoardMove>();

  readonly position = computed<Position | null>(() => {
    try {
      return parseFen(this.fen());
    } catch {
      return null;
    }
  });
  readonly selected = linkedSignal<string, string | null>({
    source: this.fen,
    computation: () => null,
  });
  readonly promotion = linkedSignal<string, { from: string; to: string } | null>({
    source: this.fen,
    computation: () => null,
  });
  readonly squares = computed<BoardSquare[]>(() => {
    const board = this.position()?.board ?? [];
    const flipped = this.orientation() === 'BLACK';
    return Array.from({ length: 64 }, (_, slot) => {
      const index = flipped ? 63 - slot : slot;
      const piece = board[index];
      const name = squareName(index);
      return {
        name,
        dark: (Math.floor(index / 8) + (index % 8)) % 2 === 1,
        piece: piece
          ? { color: piece.color === 'w' ? 'white' : 'black', name: PIECE_NAMES[piece.type] }
          : null,
        fileLabel: slot >= 56 ? name[0] : null,
        rankLabel: slot % 8 === 0 ? name[1] : null,
      };
    });
  });
  private readonly moves = computed<Move[]>(() => {
    const position = this.position();
    return position ? legalMoves(position) : [];
  });
  readonly targets = computed(() => {
    const from = this.selected();
    return new Set(
      this.moves()
        .filter((move) => move.from === from)
        .map((move) => move.to),
    );
  });
  readonly checkSquare = computed(() => {
    const position = this.position();
    if (!position || !isInCheck(position)) return null;
    return squareName(
      position.board.findIndex((piece) => piece?.type === 'k' && piece.color === position.turn),
    );
  });
  readonly outcome = computed<string | null>(() => {
    const result = this.result();
    if (result) {
      return resultText(result);
    }
    const position = this.position();
    if (!position) return null;
    const status = positionStatus(position);
    if (status === 'checkmate')
      return `${position.turn === 'w' ? 'Black' : 'White'} wins by checkmate`;
    return status === 'stalemate' ? 'Draw by stalemate' : null;
  });
  readonly canMove = computed(() => {
    const position = this.position();
    const player = this.playerColor();
    return (
      this.interactive() &&
      !!position &&
      !this.outcome() &&
      (player === null || (player === 'WHITE') === (position.turn === 'w'))
    );
  });
  readonly promotionChoices = computed(() => {
    const color = this.position()?.turn === 'b' ? 'black' : 'white';
    return (['q', 'r', 'b', 'n'] as const).map((type) => ({
      type,
      color,
      name: PIECE_NAMES[type],
    }));
  });

  movable(square: string): boolean {
    const position = this.position();
    const piece = position?.board[squareIndex(square)];
    return this.canMove() && !!piece && piece.color === position!.turn;
  }

  label(square: BoardSquare): string {
    const parts = [
      square.name,
      square.piece ? `${square.piece.color} ${square.piece.name}` : 'empty',
    ];
    if (this.checkSquare() === square.name) parts.push('in check');
    if (this.targets().has(square.name)) parts.push('possible move');
    return parts.join(', ');
  }

  choose(square: string): void {
    if (this.promotion()) return;
    const from = this.selected();
    if (from && this.targets().has(square)) {
      this.play(from, square);
    } else if (from !== square && this.movable(square)) {
      this.selected.set(square);
    } else {
      this.selected.set(null);
    }
  }

  drag(event: DragEvent, square: string): void {
    if (!this.movable(square) || this.promotion()) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData('text/plain', square);
    this.selected.set(square);
  }

  drop(event: DragEvent, square: string): void {
    event.preventDefault();
    const from = this.selected();
    if (from && from !== square && this.targets().has(square)) this.play(from, square);
  }

  promote(type: PromotionType): void {
    const pending = this.promotion();
    if (!pending) return;
    this.promotion.set(null);
    this.selected.set(null);
    this.moved.emit({ ...pending, promotion: PROMOTION_NAMES[type] });
  }

  cancel(): void {
    this.promotion.set(null);
    this.selected.set(null);
  }

  private play(from: string, to: string): void {
    if (this.moves().some((move) => move.from === from && move.to === to && move.promotion)) {
      this.promotion.set({ from, to });
      return;
    }
    this.selected.set(null);
    this.moved.emit({ from, to, promotion: null });
  }
}
