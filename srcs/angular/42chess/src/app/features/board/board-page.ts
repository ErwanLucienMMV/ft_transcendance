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
    <section class="board-page page board-layout" aria-labelledby="board-title">
      <div class="board-column">
        <app-chess-board
          [fen]="fen()"
          [orientation]="orientation()"
          [lastMove]="lastMove()"
          [interactive]="true"
          (moved)="play($event)"
        />
      </div>
      <div class="board-panel side-panel">
        <span class="eyebrow">Analysis</span>
        <h2 id="board-title">Free board</h2>
        <p class="muted">
          Move both sides freely to study a position. Nothing is sent to the server.
        </p>
        <div class="turn">
          <i [class.black]="blackToMove()" aria-hidden="true"></i>
          <p role="status">{{ turn() }}</p>
        </div>
        <div class="panel-actions">
          <button type="button" class="secondary" (click)="flip()">Flip board</button>
          <button type="button" class="secondary" (click)="load(start)">Reset</button>
        </div>
        <form
          class="form-field panel-section"
          (submit)="$event.preventDefault(); load(fenInput.value)"
        >
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
          <button type="submit" class="secondary">Load position</button>
        </form>
      </div>
    </section>
  `,
  styles: `
    .turn p {
      margin: 0;
    }
    .turn {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
    }
    .turn i {
      width: 14px;
      height: 14px;
      border-radius: 4px;
      background: #f4f1dc;
      border: 1px solid var(--border-strong);
    }
    .turn i.black {
      background: #1c2922;
    }
    form {
      margin: 0;
    }
    input {
      font-family: var(--font-mono);
      font-size: 13px;
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
  readonly blackToMove = computed(() => this.position().turn === 'b');

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
