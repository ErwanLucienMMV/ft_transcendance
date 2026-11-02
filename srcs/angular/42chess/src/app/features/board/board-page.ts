import { Component, computed, signal } from '@angular/core';
import { PlayerColor } from '../../core/realtime/game-realtime';
import { BoardMove, ChessBoard, fenAfter } from '../../shared/chess/chess-board';
import { parseFen, Position } from '../../shared/chess/chess-rules';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Local analysis board: nothing here reaches the server, so it is also the board's showcase. */
@Component({
  selector: 'app-board-page',
  imports: [ChessBoard],
  template: `
    <section class="board-page" aria-labelledby="board-title">
      <div class="board-column">
        <app-chess-board
          [fen]="fen()"
          [orientation]="orientation()"
          [lastMove]="lastMove()"
          [interactive]="true"
          (moved)="play($event)"
        />
      </div>
      <div class="board-panel">
        <span class="eyebrow">Analysis</span>
        <h2 id="board-title">Free board</h2>
        <p>Both sides move here. Nothing is sent to the server.</p>
        <p role="status">{{ turn() }}</p>
        <div class="board-actions">
          <button type="button" class="button secondary" (click)="flip()">Flip board</button>
          <button type="button" class="button secondary" (click)="load(start)">Reset</button>
        </div>
        <form class="form-field" (submit)="$event.preventDefault(); load(fenInput.value)">
          <label for="fen">Load a FEN position</label>
          <input
            #fenInput
            id="fen"
            name="fen"
            [value]="fen()"
            [attr.aria-invalid]="fenError() ? 'true' : null"
            [attr.aria-describedby]="fenError() ? 'fen-error' : null"
          />
          @if (fenError()) {
            <p id="fen-error">{{ fenError() }}</p>
          }
          <button type="submit">Load position</button>
        </form>
      </div>
    </section>
  `,
  styles: `
    .board-page {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 16px;
      display: grid;
      grid-template-columns: minmax(0, 600px) minmax(0, 1fr);
      gap: 32px;
      align-items: start;
    }
    .board-panel {
      display: grid;
      gap: 12px;
    }
    .board-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    form {
      display: grid;
      gap: 8px;
    }
    @media (max-width: 760px) {
      .board-page {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class BoardPage {
  readonly start = START;
  readonly fen = signal(START);
  readonly orientation = signal<PlayerColor>('WHITE');
  readonly lastMove = signal<{ from: string; to: string } | null>(null);
  readonly fenError = signal<string | null>(null);
  private readonly position = computed<Position>(() => parseFen(this.fen()));
  readonly turn = computed(() => `${this.position().turn === 'w' ? 'White' : 'Black'} to move.`);

  play(move: BoardMove): void {
    this.fen.set(fenAfter(this.fen(), move));
    this.lastMove.set({ from: move.from, to: move.to });
  }

  flip(): void {
    this.orientation.update((color) => (color === 'WHITE' ? 'BLACK' : 'WHITE'));
  }

  load(fen: string): void {
    try {
      parseFen(fen);
    } catch (error) {
      this.fenError.set(error instanceof Error ? error.message : 'Invalid FEN.');
      return;
    }
    this.fenError.set(null);
    this.fen.set(fen.trim().split(/\s+/).join(' '));
    this.lastMove.set(null);
  }
}
