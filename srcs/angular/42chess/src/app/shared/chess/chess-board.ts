import { isPlatformBrowser } from '@angular/common';
import {
  afterRenderEffect,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
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
  premoveTargets,
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
  /** Position on screen, from the viewer's top left: row 0 is the far rank. */
  row: number;
  col: number;
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

/** A circle (from === to) or an arrow drawn with the right mouse button. */
export interface Drawing {
  from: string;
  to: string;
}
interface Press {
  square: string;
  pointerId: number;
  x: number;
  y: number;
  dragging: boolean;
}
/** Pixels a pointer moves before a press becomes a drag. */
const DRAG_THRESHOLD = 6;
const SLIDE_MS = 180;
let boards = 0;

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
 *
 * Moves are made by clicking or tapping a piece then its square, by dragging (mouse, pen or
 * finger: Pointer Events), or with the keyboard: one tab stop, arrow keys between squares,
 * Enter to pick. In a game, a move chosen during the opponent's turn waits as a premove.
 */
@Component({
  selector: 'app-chess-board',
  templateUrl: './chess-board.html',
  styleUrl: './chess-board.css',
  host: { '(keydown.escape)': 'cancel()' },
})
export class ChessBoard {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly boardElement = viewChild<ElementRef<HTMLElement>>('board');
  readonly id = `board-${++boards}`;

  readonly fen = input.required<string>();
  readonly orientation = input<PlayerColor>('WHITE');
  readonly lastMove = input<{ from: string; to: string } | null>(null);
  readonly interactive = input(false);
  /** The colour this viewer may move; null lets whoever is to move play (analysis board). */
  readonly playerColor = input<PlayerColor | null>(null);
  /** The server's verdict wins over the locally detected checkmate or stalemate. */
  readonly result = input<BoardResult | null>(null);
  /** A square to point out, such as the piece a puzzle hint names. */
  readonly hint = input<string | null>(null);
  /** Lets the player queue a move during the opponent's turn (needs `playerColor`). */
  readonly premoves = input(false);
  /** Right-click draws circles and arrows, as on an analysis board. */
  readonly annotations = input(false);
  /** Slides the piece of the last move to its square. */
  readonly animate = input(true);
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
  /** The move queued for when the turn comes; dropped if it is not legal then. */
  readonly premove = signal<{ from: string; to: string } | null>(null);
  readonly drawings = linkedSignal<string, Drawing[]>({
    source: this.fen,
    computation: () => [],
  });
  /** The square that holds the board's only tab stop, once the player has moved around. */
  private readonly focused = signal<string | null>(null);
  /** The piece following the pointer during a drag, in pixels from the board's corner. */
  readonly ghost = signal<{
    name: string;
    color: string;
    x: number;
    y: number;
    size: number;
  } | null>(null);
  readonly dragFrom = signal<string | null>(null);
  private press: Press | null = null;
  private drawFrom: string | null = null;
  /** A move made by dragging lands where it was dropped: no slide when it is confirmed. */
  private dropped: { from: string; to: string } | null = null;
  private shown: Position | null = null;

  readonly squares = computed<BoardSquare[]>(() => {
    const board = this.position()?.board ?? [];
    const flipped = this.orientation() === 'BLACK';
    return Array.from({ length: 64 }, (_, slot) => {
      const index = flipped ? 63 - slot : slot;
      const piece = board[index];
      const name = squareName(index);
      return {
        name,
        row: Math.floor(slot / 8),
        col: slot % 8,
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
  /** The opponent is to move and the player may queue their answer. */
  readonly premoveMode = computed(() => {
    const position = this.position();
    const player = this.playerColor();
    return (
      this.premoves() &&
      !!position &&
      !!player &&
      !this.outcome() &&
      (player === 'WHITE') !== (position.turn === 'w')
    );
  });
  /** Whether the squares respond at all; a read-only board can still be explored by keyboard. */
  readonly active = computed(() => this.canMove() || this.premoveMode());
  readonly targets = computed(() => {
    const from = this.selected();
    const position = this.position();
    if (!from || !position) return new Set<string>();
    if (this.premoveMode()) return new Set(premoveTargets(position, from));
    return new Set(
      this.moves()
        .filter((move) => move.from === from)
        .map((move) => move.to),
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
  /** The square that takes Tab: where the player last was, else the piece just moved. */
  readonly tabSquare = computed(
    () =>
      this.focused() ?? this.selected() ?? this.lastMove()?.to ?? this.squares()[56]?.name ?? 'a1',
  );
  /** Circles and arrows in board units (one square is 1), from the viewer's point of view. */
  readonly shapes = computed(() => {
    const at = (name: string) => {
      const square = this.squares().find((candidate) => candidate.name === name)!;
      return { x: square.col + 0.5, y: square.row + 0.5 };
    };
    return this.drawings().map((drawing) => {
      const from = at(drawing.from);
      if (drawing.from === drawing.to) return { key: drawing.from, circle: from, arrow: null };
      const to = at(drawing.to);
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const [ux, uy] = [(to.x - from.x) / length, (to.y - from.y) / length];
      const head = 0.42;
      const base = { x: to.x - ux * head, y: to.y - uy * head };
      const side = { x: -uy * 0.22, y: ux * 0.22 };
      return {
        key: `${drawing.from}${drawing.to}`,
        circle: null,
        arrow: {
          x1: from.x,
          y1: from.y,
          x2: base.x,
          y2: base.y,
          head: [
            to,
            { x: base.x + side.x, y: base.y + side.y },
            { x: base.x - side.x, y: base.y - side.y },
          ]
            .map((point) => `${point.x},${point.y}`)
            .join(' '),
        },
      };
    });
  });

  constructor() {
    // A queued move is played as soon as the turn comes, if it is legal then.
    effect(() => {
      const premove = this.premove();
      if (!premove) return;
      if (!this.position() || this.outcome()) {
        untracked(() => this.premove.set(null));
        return;
      }
      if (this.premoveMode() || !this.canMove()) return;
      untracked(() => {
        this.premove.set(null);
        const legal = this.moves().filter(
          (move) => move.from === premove.from && move.to === premove.to,
        );
        if (legal.length)
          this.moved.emit({
            from: premove.from,
            to: premove.to,
            promotion: legal.some((move) => move.promotion) ? 'QUEEN' : null,
          });
      });
    });
    afterRenderEffect(() => {
      const position = this.position();
      const move = this.lastMove();
      const before = this.shown;
      this.shown = position;
      if (before && position && move && before !== position)
        untracked(() => this.slide(before, position, move));
    });
  }

  movable(square: string): boolean {
    const position = this.position();
    const piece = position?.board[squareIndex(square)];
    if (!position || !piece) return false;
    if (this.canMove()) return piece.color === position.turn;
    return this.premoveMode() && piece.color === (this.playerColor() === 'WHITE' ? 'w' : 'b');
  }

  label(square: BoardSquare): string {
    const parts = [
      square.name,
      square.piece ? `${square.piece.color} ${square.piece.name}` : 'empty',
    ];
    if (this.checkSquare() === square.name) parts.push('in check');
    if (this.hint() === square.name) parts.push('hint');
    const premove = this.premove();
    if (premove?.from === square.name) parts.push('premove from here');
    if (premove?.to === square.name) parts.push('premove to here');
    if (this.targets().has(square.name)) parts.push('possible move');
    return parts.join(', ');
  }

  choose(square: string): void {
    if (this.promotion()) return;
    this.focused.set(square);
    const from = this.selected();
    if (this.premoveMode()) {
      if (from && this.targets().has(square)) {
        this.premove.set({ from, to: square });
        this.selected.set(null);
      } else if (from !== square && this.movable(square)) {
        this.selected.set(square);
      } else {
        // A click away from any piece cancels the queued move too.
        if (!from) this.premove.set(null);
        this.selected.set(null);
      }
      return;
    }
    if (from && this.targets().has(square)) {
      this.play(from, square);
    } else if (from !== square && this.movable(square)) {
      this.selected.set(square);
    } else {
      this.selected.set(null);
    }
  }

  /** Keyboard activation; a pointer press is handled on release, by pointerUp. */
  click(event: MouseEvent, square: string): void {
    if (event.detail === 0) this.choose(square);
  }

  pointerDown(event: PointerEvent): void {
    const square = this.squareOf(event.target);
    if (!square) return;
    if (event.button === 2) {
      this.premove.set(null);
      if (this.annotations()) this.drawFrom = square;
      return;
    }
    if (event.button !== 0 || this.promotion()) return;
    if (this.annotations()) this.drawings.set([]);
    this.press = {
      square,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragging: false,
    };
    // A finger on a piece drags it instead of scrolling the page (see touch-action).
    if (this.movable(square))
      this.boardElement()?.nativeElement.setPointerCapture?.(event.pointerId);
  }

  pointerMove(event: PointerEvent): void {
    const press = this.press;
    if (!press || press.pointerId !== event.pointerId) return;
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD) return;
      if (!this.movable(press.square)) return;
      press.dragging = true;
      this.focused.set(press.square);
      this.selected.set(press.square);
      this.dragFrom.set(press.square);
    }
    event.preventDefault();
    const rect = this.boardElement()?.nativeElement.getBoundingClientRect();
    const piece = this.squares().find((square) => square.name === press.square)?.piece;
    if (!rect || !piece) return;
    this.ghost.set({
      ...piece,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      size: rect.width / 8,
    });
  }

  pointerUp(event: PointerEvent): void {
    if (event.button === 2) {
      const from = this.drawFrom;
      this.drawFrom = null;
      const to = this.squareAt(event.clientX, event.clientY) ?? this.squareOf(event.target);
      if (from && to && this.annotations()) this.toggleDrawing({ from, to });
      return;
    }
    const press = this.press;
    if (!press || press.pointerId !== event.pointerId) return;
    this.press = null;
    if (!press.dragging) {
      this.choose(press.square);
      return;
    }
    this.ghost.set(null);
    this.dragFrom.set(null);
    const target = this.squareAt(event.clientX, event.clientY);
    if (!target || target === press.square || !this.targets().has(target)) return;
    if (this.premoveMode()) {
      this.premove.set({ from: press.square, to: target });
      this.selected.set(null);
      return;
    }
    this.dropped = { from: press.square, to: target };
    this.play(press.square, target);
  }

  pointerCancel(): void {
    this.press = null;
    this.ghost.set(null);
    this.dragFrom.set(null);
  }

  /** Right-click draws on an analysis board, and cancels a premove in a game. */
  contextMenu(event: MouseEvent): void {
    if (this.annotations() || this.premoves()) event.preventDefault();
  }

  /** Arrow keys move between squares as seen on screen; Home and End reach the rank's ends. */
  keyDown(event: KeyboardEvent): void {
    const name = this.squareOf(event.target);
    const square = this.squares().find((candidate) => candidate.name === name);
    if (!square) return;
    let { row, col } = square;
    switch (event.key) {
      case 'ArrowUp':
        row--;
        break;
      case 'ArrowDown':
        row++;
        break;
      case 'ArrowLeft':
        col--;
        break;
      case 'ArrowRight':
        col++;
        break;
      case 'Home':
        col = 0;
        break;
      case 'End':
        col = 7;
        break;
      default:
        return;
    }
    event.preventDefault();
    row = Math.min(7, Math.max(0, row));
    col = Math.min(7, Math.max(0, col));
    const next = this.squares()[row * 8 + col].name;
    this.focused.set(next);
    this.boardElement()
      ?.nativeElement.querySelector<HTMLElement>(`[data-square="${next}"]`)
      ?.focus();
  }

  focusIn(event: FocusEvent): void {
    const square = this.squareOf(event.target);
    if (square) this.focused.set(square);
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
    this.premove.set(null);
  }

  private toggleDrawing(drawing: Drawing): void {
    this.drawings.update((list) =>
      list.some((item) => item.from === drawing.from && item.to === drawing.to)
        ? list.filter((item) => item.from !== drawing.from || item.to !== drawing.to)
        : [...list, drawing],
    );
  }

  private squareOf(target: EventTarget | null): string | null {
    return target instanceof Element
      ? (target.closest('[data-square]')?.getAttribute('data-square') ?? null)
      : null;
  }

  /** The square under a point on screen, or null outside the board. */
  private squareAt(x: number, y: number): string | null {
    const rect = this.boardElement()?.nativeElement.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    const col = Math.floor(((x - rect.left) / rect.width) * 8);
    const row = Math.floor(((y - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return this.squares()[row * 8 + col].name;
  }

  /** Slides the piece that just moved, when this position comes from the previous one by it. */
  private slide(before: Position, after: Position, move: { from: string; to: string }): void {
    const dropped = this.dropped;
    this.dropped = null;
    if (!this.browser || !this.animate()) return;
    if (dropped?.from === move.from && dropped.to === move.to) return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    const from = squareIndex(move.from);
    const to = squareIndex(move.to);
    const moving = before.board[from];
    const landed = after.board[to];
    if (!moving || after.board[from] || landed?.color !== moving.color) return;
    const squares = this.squares();
    const origin = squares.find((square) => square.name === move.from);
    const target = squares.find((square) => square.name === move.to);
    const element = this.host.nativeElement.querySelector<HTMLElement>(
      `[data-square="${move.to}"]`,
    );
    const piece = element?.querySelector<SVGElement>('.piece');
    if (!origin || !target || !element || !piece || typeof piece.animate !== 'function') return;
    const size = element.offsetWidth;
    const dx = (origin.col - target.col) * size;
    const dy = (origin.row - target.row) * size;
    element.classList.add('moving');
    const animation = piece.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: SLIDE_MS, easing: 'ease-out' },
    );
    animation.onfinish = animation.oncancel = () => element.classList.remove('moving');
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
