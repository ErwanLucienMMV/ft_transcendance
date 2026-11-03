import { Component, computed, input } from '@angular/core';
import { material, parseFen, PieceType } from './chess-rules';
import { tr } from '../../core/i18n/i18n';

const NAMES = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
} as const satisfies Record<PieceType, string>;

/** The pieces one side has taken, and its material lead ("+2") when it has one. */
@Component({
  selector: 'app-captured-pieces',
  template: `
    @if (taken().length || lead() > 0) {
      <span class="captured" [attr.aria-label]="spoken()">
        @for (piece of taken(); track $index) {
          <svg viewBox="0 0 64 64" aria-hidden="true" [class]="'piece ' + victimColor()">
            <use [attr.href]="'/chess-pieces.svg#' + piece" />
          </svg>
        }
        @if (lead() > 0) {
          <span class="lead" aria-hidden="true">+{{ lead() }}</span>
        }
      </span>
    }
  `,
  styles: `
    .captured {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      min-height: 18px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
    }
    .piece {
      width: 18px;
      height: 18px;
      margin-right: -5px;
      fill: currentColor;
    }
    .piece.white {
      color: #fffde9;
      stroke: #243329;
      stroke-width: 2;
    }
    .piece.black {
      color: #1c2922;
      stroke: #e2e6d8;
      stroke-width: 1.2;
    }
    .lead {
      margin-left: 9px;
    }
  `,
})
export class CapturedPieces {
  readonly fen = input.required<string>();
  /** The side whose captures are shown. */
  readonly color = input.required<'WHITE' | 'BLACK'>();
  private readonly material = computed(() => {
    try {
      return material(parseFen(this.fen()));
    } catch {
      return null;
    }
  });
  readonly victimColor = computed(() => (this.color() === 'WHITE' ? 'black' : 'white'));
  readonly taken = computed(() =>
    (this.material()?.captured[this.color() === 'WHITE' ? 'w' : 'b'] ?? []).map(
      (type) => NAMES[type],
    ),
  );
  readonly lead = computed(() => {
    const balance = this.material()?.balance ?? 0;
    return this.color() === 'WHITE' ? balance : -balance;
  });
  readonly spoken = computed(() => {
    const list = this.taken();
    const text = list.length
      ? tr('chess.captured.list', {
          pieces: list.map((name) => tr(`chess.pieces.${name}`)).join(', '),
        })
      : tr('chess.captured.none');
    return this.lead() > 0 ? tr('chess.captured.ahead', { text, lead: this.lead() }) : text;
  });
}
