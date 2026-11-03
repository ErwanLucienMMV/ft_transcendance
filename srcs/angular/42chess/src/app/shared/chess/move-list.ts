import { Component, input, output } from '@angular/core';
import type { MoveRow } from './game-text';

/**
 * The moves of a game, two per numbered row. In a replay every move is a button that shows
 * its position; the shown one is marked as the current step.
 */
@Component({
  selector: 'app-move-list',
  template: `
    @if (rows().length) {
      <ol [attr.aria-label]="label()">
        @for (row of rows(); track row.number) {
          <li [attr.value]="row.number">
            @for (cell of [row.white, row.black]; track $index) {
              @if (cell && navigable()) {
                <button
                  type="button"
                  class="move"
                  [attr.aria-current]="cell.ply === current() ? 'step' : null"
                  (click)="selected.emit(cell.ply)"
                >
                  {{ cell.text }}
                </button>
              } @else {
                <span
                  class="move"
                  [attr.aria-current]="cell && cell.ply === current() ? 'step' : null"
                  >{{ cell?.text ?? ($index === 0 ? '…' : '') }}</span
                >
              }
            }
          </li>
        }
      </ol>
    } @else {
      <p class="muted">{{ empty() }}</p>
    }
  `,
  host: { class: 'move-list-body' },
})
export class MoveList {
  readonly rows = input.required<readonly MoveRow[]>();
  /** The ply on show, highlighted; null for none. */
  readonly current = input<number | null>(null);
  readonly navigable = input(false);
  readonly label = input('Moves');
  readonly empty = input('No moves yet.');
  readonly selected = output<number>();
}
