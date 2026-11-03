import { Component, input } from '@angular/core';

export type PieceName = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';

/**
 * Nothing to show yet: a faint piece, one line saying so and what to do next. The text and
 * any action are projected; without a heading it is a plain loading or notice tile.
 */
@Component({
  selector: 'app-empty-state',
  template: `
    @if (piece(); as name) {
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <use [attr.href]="'/chess-pieces.svg#' + name" />
      </svg>
    }
    @if (heading(); as text) {
      <strong>{{ text }}</strong>
    }
    <ng-content />
  `,
  host: { class: 'empty', '[attr.role]': "loading() ? 'status' : null" },
})
export class EmptyState {
  readonly heading = input<string | null>(null);
  readonly piece = input<PieceName | null>(null);
  /** A loading tile is announced politely when it appears. */
  readonly loading = input(false);
}
