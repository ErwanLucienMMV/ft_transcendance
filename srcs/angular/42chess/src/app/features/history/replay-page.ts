import {
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin, map } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import type { GameMove, GamePlayer, PlayerColor } from '../../core/realtime/game-realtime';
import { ChessBoard } from '../../shared/chess/chess-board';
import { botName, moveRows, resultText, START_FEN } from '../../shared/chess/game-text';
import { GamesApi, GameView } from '../game/games-api';

/**
 * Replay of a finished game from its stored moves: every position comes from the server's
 * `fen` after each move, so the browser never recomputes the game.
 */
@Component({
  selector: 'app-replay-page',
  imports: [ChessBoard, RouterLink],
  templateUrl: './replay-page.html',
  styleUrl: './replay-page.css',
  host: {
    '(keydown.arrowleft)': 'step(-1, $event)',
    '(keydown.arrowright)': 'step(1, $event)',
    '(keydown.home)': 'goTo(0, $event)',
    '(keydown.end)': 'goTo(moves().length, $event)',
  },
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
  /** Plies shown from the start; a newly loaded game opens on its final position. */
  readonly ply = linkedSignal(() => this.moves().length);

  readonly rows = computed(() => moveRows(this.moves()));
  readonly fen = computed(() => (this.ply() === 0 ? START_FEN : this.moves()[this.ply() - 1].fen));
  readonly lastMove = computed(() => {
    const move = this.moves()[this.ply() - 1];
    return move ? { from: move.from, to: move.to } : null;
  });
  readonly myColor = computed<PlayerColor | null>(() => {
    const game = this.game();
    const me = this.session.user()?.id;
    if (!game || !me) return null;
    if (game.whitePlayer?.id === me) return 'WHITE';
    return game.blackPlayer?.id === me ? 'BLACK' : null;
  });
  readonly orientation = computed<PlayerColor>(() => {
    const base = this.myColor() ?? 'WHITE';
    return this.flipped() ? (base === 'WHITE' ? 'BLACK' : 'WHITE') : base;
  });
  readonly finished = computed(() => this.game()?.status === 'FINISHED');
  readonly atEnd = computed(() => this.ply() === this.moves().length);
  readonly headline = computed(() => {
    const result = this.game()?.result;
    return result ? resultText(result, this.myColor()) : 'Game replay';
  });

  constructor() {
    effect(() => {
      const id = this.gameId();
      untracked(() => this.load(id));
    });
  }

  name(player: GamePlayer | null): string {
    if (!player) return 'Unknown player';
    if (player.botDifficulty) return botName(player.botDifficulty);
    return player.elo === null ? player.username : `${player.username} (${player.elo})`;
  }

  goTo(ply: number, event?: Event): void {
    event?.preventDefault();
    this.ply.set(Math.min(Math.max(ply, 0), this.moves().length));
  }

  step(delta: number, event?: Event): void {
    this.goTo(this.ply() + delta, event);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.game.set(null);
    this.moves.set([]);
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
            ? 'This game does not exist.'
            : 'The game could not be loaded. Try again later.',
        );
      },
    });
  }
}
