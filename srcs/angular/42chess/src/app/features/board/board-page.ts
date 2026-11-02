import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { PlayerColor } from '../../core/realtime/game-realtime';
import { BoardMove, ChessBoard, fenAfter } from '../../shared/chess/chess-board';
import {
  FenError,
  FenProblem,
  parseFen,
  Position,
  PromotionType,
  sanOf,
} from '../../shared/chess/chess-rules';
import { moveRows, MoveRow } from '../../shared/chess/game-text';
import { MoveList } from '../../shared/chess/move-list';
import { Icon } from '../../shared/ui/icon';
import { TranslocoDirective } from '@jsverse/transloco';
import { tr } from '../../core/i18n/i18n';

interface Played {
  from: string;
  to: string;
  notation: string;
  /** The position before the move, to take it back. */
  before: string;
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Local analysis board: nothing here reaches the server, so it is also the board's showcase.
 * `/board?fen=…` opens a position, such as the end of a game.
 */
@Component({
  selector: 'app-board-page',
  imports: [TranslocoDirective, ChessBoard, Icon, MoveList],
  template: `
    <ng-container *transloco="let t">
      <section class="board-page page board-layout" aria-labelledby="board-title">
        <div class="board-column">
          <app-chess-board
            [fen]="fen()"
            [orientation]="orientation()"
            [lastMove]="lastMove()"
            [interactive]="true"
            [annotations]="true"
            (moved)="play($event)"
          />
        </div>
        <div class="board-panel side-panel">
          <span class="eyebrow">{{ t('board.eyebrow') }}</span>
          <h1 id="board-title">{{ t('board.title') }}</h1>
          <p class="muted">{{ t('board.intro') }}</p>
          <div class="turn">
            <i [class.black]="blackToMove()" aria-hidden="true"></i>
            <p role="status">{{ turn() }}</p>
          </div>
          <div class="panel-actions">
            <button type="button" class="secondary" (click)="flip()">
              <app-icon name="flip" />{{ t('board.flip') }}
            </button>
            <button type="button" class="secondary" [disabled]="!played().length" (click)="undo()">
              <app-icon name="chevron-left" />{{ t('board.takeBack') }}
            </button>
            <button type="button" class="secondary" (click)="load(start)">
              {{ t('board.reset') }}
            </button>
          </div>
          <section class="move-list panel-section" aria-labelledby="board-moves-title">
            <h2 id="board-moves-title">{{ t('board.moves') }}</h2>
            <app-move-list [rows]="rows()" [empty]="t('board.empty')" />
          </section>
          <form
            class="form-field panel-section"
            (submit)="$event.preventDefault(); load(fenInput.value)"
          >
            <label for="fen">{{ t('board.fenLabel') }}</label>
            <input
              #fenInput
              id="fen"
              name="fen"
              [value]="fen()"
              [attr.aria-invalid]="fenError() ? 'true' : null"
              [attr.aria-describedby]="fenError() ? 'fen-error' : null"
            />
            @if (fenError()) {
              <p id="fen-error">{{ fenText() }}</p>
            }
            <button type="submit" class="secondary">{{ t('board.load') }}</button>
          </form>
        </div>
      </section>
    </ng-container>
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
  readonly fenError = signal<{ problem: FenProblem | 'other'; value: string } | null>(null);
  readonly fenText = computed(() => {
    const error = this.fenError();
    return error ? tr(`board.fen.${error.problem}`, { value: error.value }) : '';
  });
  readonly played = signal<Played[]>([]);
  readonly lastMove = computed(() => {
    const last = this.played().at(-1);
    return last ? { from: last.from, to: last.to } : null;
  });
  private readonly position = computed<Position>(() => parseFen(this.fen()));
  readonly turn = computed(() =>
    tr('board.toMove', {
      side: tr(this.position().turn === 'w' ? 'game.sides.WHITE' : 'game.sides.BLACK'),
    }),
  );
  readonly blackToMove = computed(() => this.position().turn === 'b');
  /** Numbered like a game: a position with Black to move starts with "1…". */
  readonly rows = computed<MoveRow[]>(() => {
    const played = this.played();
    if (!played.length) return [];
    const first = parseFen(played[0].before);
    const offset = (first.fullmove - 1) * 2 + (first.turn === 'b' ? 1 : 0);
    return moveRows(
      played.map((move, index) => ({
        number: offset + index + 1,
        playerId: '',
        from: move.from,
        to: move.to,
        notation: move.notation,
        fen: '',
        timestamp: '',
      })),
    );
  });

  constructor() {
    inject(ActivatedRoute)
      .queryParamMap.pipe(takeUntilDestroyed())
      .subscribe((params) => {
        const fen = params.get('fen');
        if (fen) this.load(fen);
      });
  }

  play(move: BoardMove): void {
    const before = this.fen();
    const notation = sanOf(parseFen(before), {
      from: move.from,
      to: move.to,
      promotion: move.promotion ? (move.promotion[0].toLowerCase() as PromotionType) : undefined,
    });
    this.fen.set(fenAfter(before, move));
    this.played.update((list) => [...list, { from: move.from, to: move.to, notation, before }]);
  }

  undo(): void {
    const last = this.played().at(-1);
    if (!last) return;
    this.fen.set(last.before);
    this.played.update((list) => list.slice(0, -1));
  }

  flip(): void {
    this.orientation.update((color) => (color === 'WHITE' ? 'BLACK' : 'WHITE'));
  }

  load(fen: string): void {
    try {
      parseFen(fen);
    } catch (error) {
      this.fenError.set(
        error instanceof FenError
          ? { problem: error.problem, value: error.value }
          : { problem: 'other', value: '' },
      );
      return;
    }
    this.fenError.set(null);
    this.fen.set(fen.trim().split(/\s+/).join(' '));
    this.played.set([]);
  }
}
