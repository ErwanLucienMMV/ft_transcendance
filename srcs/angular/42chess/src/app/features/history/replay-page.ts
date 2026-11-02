import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  linkedSignal,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin, map } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import type { GameMove, PlayerColor } from '../../core/realtime/game-realtime';
import { ChessBoard } from '../../shared/chess/chess-board';
import { moveRows, playerLabel, resultText, seatOf, START_FEN } from '../../shared/chess/game-text';
import { MoveList } from '../../shared/chess/move-list';
import { downloadPgn, gamePgn } from '../../shared/chess/pgn';
import { Icon } from '../../shared/ui/icon';
import { GamesApi, GameView } from '../game/games-api';
import { Alert } from '../../shared/ui/alert';
import { EmptyState } from '../../shared/ui/empty-state';
import { isUuid } from '../../core/api/ids';
import { tr } from '../../core/i18n/i18n';
import { TranslocoDirective } from '@jsverse/transloco';

/** One move per step while the replay plays by itself. */
export const AUTOPLAY_MS = 1000;

/**
 * Replay of a finished game from its stored moves: every position comes from the server's
 * `fen` after each move, so the browser never recomputes the game.
 */
@Component({
  selector: 'app-replay-page',
  imports: [TranslocoDirective, EmptyState, Alert, ChessBoard, Icon, MoveList, RouterLink],
  templateUrl: './replay-page.html',
  styleUrl: './replay-page.css',
  host: { '(document:keydown)': 'key($event)' },
})
export class ReplayPage {
  private readonly api = inject(GamesApi);
  private readonly session = inject(AuthSession);
  readonly gameId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id') ?? '')),
    { initialValue: '' },
  );
  readonly game = signal<GameView | null>(null);
  readonly moves = signal<GameMove[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly flipped = signal(false);
  readonly playing = signal(false);
  readonly name = playerLabel;
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  /** Plies shown from the start; a newly loaded game opens on its final position. */
  readonly ply = linkedSignal(() => this.moves().length);

  readonly rows = computed(() => moveRows(this.moves()));
  readonly fen = computed(() => (this.ply() === 0 ? START_FEN : this.moves()[this.ply() - 1].fen));
  readonly lastMove = computed(() => {
    const move = this.moves()[this.ply() - 1];
    return move ? { from: move.from, to: move.to } : null;
  });
  readonly myColor = computed(() => seatOf(this.game(), this.session.user()?.id));
  readonly orientation = computed<PlayerColor>(() => {
    const base = this.myColor() ?? 'WHITE';
    return this.flipped() ? (base === 'WHITE' ? 'BLACK' : 'WHITE') : base;
  });
  readonly finished = computed(() => this.game()?.status === 'FINISHED');
  readonly atEnd = computed(() => this.ply() === this.moves().length);
  readonly headline = computed(() => {
    const result = this.game()?.result;
    return result ? resultText(result, this.myColor()) : tr('history.replay.title');
  });
  /** The analysis board opens on the position shown. */
  readonly analysisLink = computed(() => ({ fen: this.fen() }));

  constructor() {
    effect(() => {
      const id = this.gameId();
      untracked(() => this.load(id));
    });
    let timer: ReturnType<typeof setInterval> | undefined;
    effect(() => {
      clearInterval(timer);
      timer = undefined;
      if (!this.playing() || !this.browser) return;
      timer = setInterval(() => {
        if (this.atEnd()) this.playing.set(false);
        else this.ply.update((ply) => ply + 1);
      }, AUTOPLAY_MS);
    });
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  goTo(ply: number, event?: Event): void {
    event?.preventDefault();
    this.ply.set(Math.min(Math.max(ply, 0), this.moves().length));
  }

  step(delta: number, event?: Event): void {
    this.playing.set(false);
    this.goTo(this.ply() + delta, event);
  }

  /** Plays the game from the shown position, one move a second; from the start when at the end. */
  togglePlay(): void {
    if (this.playing()) {
      this.playing.set(false);
      return;
    }
    if (this.atEnd()) this.ply.set(0);
    this.playing.set(this.moves().length > 0);
  }

  /**
   * Arrow keys step through the game from anywhere on the page, unless the player is typing
   * or exploring the board with them (the board handles those keys first).
   */
  key(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const moves = this.moves().length;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => this.step(-1),
      ArrowRight: () => this.step(1),
      Home: () => this.step(-moves),
      End: () => this.step(moves),
    };
    const action = actions[event.key];
    if (!action || !this.game()) return;
    event.preventDefault();
    action();
  }

  downloadPgn(): void {
    const game = this.game();
    if (!game) return;
    const pgn = gamePgn(game, this.moves(), this.browser ? location.host : '42 Chess');
    downloadPgn(pgn, `42chess_${game.id.slice(0, 8)}`, this.document);
  }

  private load(id: string): void {
    this.error.set(null);
    this.game.set(null);
    this.moves.set([]);
    if (!isUuid(id)) {
      this.loading.set(false);
      this.error.set(tr('history.replay.missing'));
      return;
    }
    this.loading.set(true);
    forkJoin([this.api.get(id), this.api.moves(id)]).subscribe({
      next: ([game, { moves }]) => {
        this.game.set(game);
        this.moves.set(moves);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        const status = error instanceof ApiError ? error.statusCode : 0;
        this.error.set(
          status === 404 || status === 400
            ? tr('history.replay.missing')
            : tr('history.replay.failed'),
        );
      },
    });
  }
}
