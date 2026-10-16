import { Component } from '@angular/core';

/** An illustrative opening position, independent of the live game controller. */
@Component({
  selector: 'app-chess-artwork',
  template: `
    <div
      class="board"
      role="img"
      aria-label="Chessboard in the opening position, white pieces at the bottom"
    >
      @for (rank of position; track $index; let row = $index) {
        @for (piece of rank; track $index; let column = $index) {
          <span class="square" [class.dark]="(row + column) % 2 === 1">
            @if (piece !== '.') {
              <svg
                viewBox="0 0 64 64"
                aria-hidden="true"
                [class.white-piece]="piece === piece.toUpperCase()"
              >
                <use [attr.href]="'/chess-pieces.svg#' + names[piece.toLowerCase()]" />
              </svg>
            }
          </span>
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .board {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      grid-template-rows: repeat(8, minmax(0, 1fr));
      aspect-ratio: 1;
      overflow: hidden;
      border-radius: 3px;
    }
    .square {
      min-width: 0;
      min-height: 0;
      display: grid;
      place-items: center;
      background: #f4f1dc;
    }
    .dark {
      background: #35443a;
    }
    svg {
      display: block;
      width: 89%;
      height: 89%;
      fill: currentColor;
      color: #1c2922;
      stroke: #e2e6d8;
      stroke-width: 1.1;
      stroke-linejoin: round;
    }
    .white-piece {
      color: #fffde9;
      stroke: #243329;
      stroke-width: 1.8;
    }
  `,
})
export class ChessArtwork {
  readonly position = [
    'rnbqkbnr',
    'pppppppp',
    '........',
    '........',
    '........',
    '........',
    'PPPPPPPP',
    'RNBQKBNR',
  ].map((rank) => [...rank]);
  readonly names: Record<string, string> = {
    p: 'pawn',
    r: 'rook',
    n: 'knight',
    b: 'bishop',
    q: 'queen',
    k: 'king',
  };
}
