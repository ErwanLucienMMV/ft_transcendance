import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import { GameMove, GamePlayer, GameRealtime, PlayerColor } from '../../core/realtime/game-realtime';
import { BoardMove, ChessBoard, fenAfter } from '../../shared/chess/chess-board';
import { botName, moveRows, resultText, seatOf } from '../../shared/chess/game-text';
import { GameClock } from './game-clock';
import { GamesApi } from './games-api';

interface Seat {
  color: PlayerColor;
  player: GamePlayer | null;
  remaining: number | null;
  running: boolean;
}

/**
 * Live game. The server owns every rule: a move is only shown ahead of its confirmation while
 * the request is in flight, and the next GAME_STATE or ERROR replaces that preview.
 */
@Component({
  selector: 'app-game-page',
  imports: [ChessBoard, GameClock, RouterLink],
  templateUrl: './game-page.html',
  styleUrl: './game-page.css',
})
export class GamePage {
  readonly realtime = inject(GameRealtime);
  private readonly session = inject(AuthSession);
  private readonly games = inject(GamesApi);
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly route = inject(ActivatedRoute);
  readonly gameId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') ?? '')), {
    initialValue: '',
  });
  /** `?watch=1` (from the live games list) opens the game as a spectator straight away. */
  private readonly watchRequested = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.has('watch'))),
    { initialValue: false },
  );
  readonly invalid = signal(false);
  private readonly proposed = signal<{ base: string; move: BoardMove } | null>(null);
  private readonly now = signal(Date.now());
  readonly confirmingResign = signal(false);
  readonly retryingBot = signal(false);
  readonly retryError = signal<string | null>(null);
  readonly copied = signal(false);

  readonly game = this.realtime.game;
  readonly moves = computed<GameMove[]>(() => this.game()?.moves ?? []);
  readonly me = computed(() => this.session.user()?.id ?? null);
  readonly spectating = computed(() => this.realtime.mode() === 'spectator');
  readonly spectators = computed(() => this.game()?.spectatorCount ?? 0);
  /** The seat this page plays; a spectator plays none, even when signed in as a player. */
  readonly myColor = computed(() => (this.spectating() ? null : seatOf(this.game(), this.me())));
  readonly orientation = computed<PlayerColor>(() => this.myColor() ?? 'WHITE');
  readonly bot = computed(
    () =>
      this.game()?.whitePlayer?.botDifficulty ?? this.game()?.blackPlayer?.botDifficulty ?? null,
  );
  readonly active = computed(() => this.game()?.status === 'ACTIVE');
  readonly myTurn = computed(
    () => this.active() && !!this.myColor() && this.game()?.board.turn === this.myColor(),
  );

  /** The confirmed position, or the pending move on top of it while the server decides. */
  readonly fen = computed(() => {
    const game = this.game();
    if (!game) return '';
    const proposed = this.proposed();
    if (!this.realtime.pending() || proposed?.base !== game.board.fen) return game.board.fen;
    try {
      return fenAfter(game.board.fen, proposed.move);
    } catch {
      return game.board.fen;
    }
  });
  readonly previewing = computed(() => this.fen() !== this.game()?.board.fen);
  readonly lastMove = computed(() => {
    const proposed = this.proposed();
    if (this.previewing() && proposed) return proposed.move;
    const last = this.moves().at(-1);
    return last ? { from: last.from, to: last.to } : null;
  });
  readonly canPlay = computed(
    () =>
      this.myTurn() && !this.realtime.pending() && this.realtime.transport.state() === 'connected',
  );

  readonly top = computed(() => this.seat(this.orientation() === 'WHITE' ? 'BLACK' : 'WHITE'));
  readonly bottom = computed(() => this.seat(this.orientation()));

  readonly rows = computed(() => moveRows(this.moves()));

  /** The bot owes a move: right after mine (still a preview) or once the turn is its own. */
  readonly botThinking = computed(
    () =>
      !!this.bot() &&
      this.active() &&
      !!this.myColor() &&
      !this.realtime.game()?.botError &&
      (this.previewing() || !this.myTurn()),
  );
  readonly botFailed = computed(
    () => !!this.bot() && this.active() && !!this.realtime.game()?.botError,
  );

  readonly drawOfferedByOpponent = computed(() => {
    const offer = this.game()?.drawOffer;
    return !!offer && !!this.myColor() && offer.playerId !== this.me();
  });
  readonly drawOfferedByMe = computed(() => this.game()?.drawOffer?.playerId === this.me());
  readonly drawDeclined = computed(() => {
    const by = this.realtime.drawDeclinedBy();
    return by !== null && by !== this.me();
  });

  readonly headline = computed(() => {
    const game = this.game();
    if (!game) return '';
    if (game.status === 'WAITING') return 'Waiting for an opponent';
    if (game.status === 'FINISHED') return this.outcome();
    if (!this.myColor()) return `${game.board.turn === 'WHITE' ? 'White' : 'Black'} to move`;
    if (this.botFailed()) return 'The bot could not play';
    if (this.botThinking()) return 'The bot is thinking…';
    if (this.myTurn()) return this.previewing() ? 'Sending your move…' : 'Your turn';
    return "Opponent's turn";
  });

  readonly link = computed(() =>
    this.browser ? `${location.origin}/game/${this.gameId()}` : `/game/${this.gameId()}`,
  );

  readonly connection = computed(() => {
    switch (this.realtime.transport.state()) {
      case 'connecting':
      case 'authenticating':
        return 'Connecting to the game…';
      case 'reconnecting':
        return 'Connection lost. Reconnecting…';
      case 'unavailable':
        return 'You are offline from this game.';
      default:
        return null;
    }
  });

  constructor() {
    effect(() => {
      const id = this.gameId();
      const watch = this.watchRequested();
      untracked(() => this.open(id, watch));
    });
    effect(() => {
      // A rejected or replaced move must not linger as a preview.
      if (!this.realtime.pending()) untracked(() => this.proposed.set(null));
    });
    effect(() => {
      // Someone without a seat in a started game watches it instead.
      if (this.realtime.error()?.code === 'NOT_A_PLAYER')
        untracked(() => this.realtime.watch(this.gameId(), 'spectator'));
    });
    if (this.browser) {
      const timer = setInterval(() => this.now.set(Date.now()), 200);
      inject(DestroyRef).onDestroy(() => clearInterval(timer));
    }
    inject(DestroyRef).onDestroy(() => this.realtime.leave());
  }

  play(move: BoardMove): void {
    const game = this.game();
    if (!game || !this.canPlay()) return;
    if (this.realtime.move(move.from, move.to, move.promotion))
      this.proposed.set({ base: game.board.fen, move });
  }

  resign(): void {
    if (!this.confirmingResign()) {
      this.confirmingResign.set(true);
      return;
    }
    this.confirmingResign.set(false);
    this.realtime.resign();
  }

  /** The server keeps a failed bot turn pending; this asks it to try again. */
  retryBot(): void {
    if (this.retryingBot()) return;
    this.retryingBot.set(true);
    this.retryError.set(null);
    this.games.resumeBot(this.gameId()).subscribe({
      next: () => this.retryingBot.set(false),
      error: () => {
        this.retryingBot.set(false);
        this.retryError.set('The bot is still unavailable. Try again in a moment.');
      },
    });
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link());
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  name(player: GamePlayer | null): string {
    if (!player) return 'Waiting for a player';
    if (player.botDifficulty) return botName(player.botDifficulty);
    return player.id === this.me() ? `${player.username} (you)` : player.username;
  }

  /** Leaves the spectator room for the list of live games. */
  stopWatching(): void {
    this.realtime.leave();
    void this.router.navigate(['/live']);
  }

  private open(id: string, watch: boolean): void {
    this.proposed.set(null);
    this.confirmingResign.set(false);
    this.copied.set(false);
    this.retryError.set(null);
    this.invalid.set(!this.realtime.watch(id, watch ? 'spectator' : 'player'));
  }

  private seat(color: PlayerColor): Seat {
    const game = this.game();
    const player = (color === 'WHITE' ? game?.whitePlayer : game?.blackPlayer) ?? null;
    const clocks = game?.clocks;
    const running = !!game && game.status === 'ACTIVE' && game.board.turn === color;
    let remaining: number | null = null;
    if (clocks) {
      remaining = color === 'WHITE' ? clocks.white : clocks.black;
      if (running) remaining -= this.now() - this.realtime.clocksAt();
      remaining = Math.max(0, remaining);
    }
    return { color, player, remaining, running };
  }

  private outcome(): string {
    const result = this.game()?.result;
    return result ? resultText(result, this.myColor()) : 'Game over';
  }
}
