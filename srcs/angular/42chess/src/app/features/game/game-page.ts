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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AuthSession } from '../../core/auth/auth-session';
import { SessionLifecycle } from '../../core/auth/session-lifecycle';
import { Preferences } from '../../core/preferences/preferences';
import { GameMove, GamePlayer, GameRealtime, PlayerColor } from '../../core/realtime/game-realtime';
import { moveSound, Sounds } from '../../core/sound/sounds';
import { PageTitle } from '../../core/title/page-title';
import { CapturedPieces } from '../../shared/chess/captured-pieces';
import { parseFen, PromotionType, sanOf } from '../../shared/chess/chess-rules';
import { BoardMove, ChessBoard, fenAfter } from '../../shared/chess/chess-board';
import {
  botName,
  displayName,
  moveRows,
  repetitions,
  resultText,
  seatOf,
  spokenMove,
  START_FEN,
} from '../../shared/chess/game-text';
import { MoveList } from '../../shared/chess/move-list';
import { downloadPgn, gamePgn } from '../../shared/chess/pgn';
import { Icon } from '../../shared/ui/icon';
import { Toasts } from '../../shared/ui/toasts';
import { UserAvatar } from '../../shared/user-avatar';
import { Challenges } from '../social/challenge';
import { GameChat } from './game-chat';
import { GameClock } from './game-clock';
import { GamesApi, timeControlLabel } from './games-api';
import { formatClock } from './game-clock';
import { EmptyState } from '../../shared/ui/empty-state';
import { tr, trCount } from '../../core/i18n/i18n';
import { errorText } from '../../core/api/error-text';
import { TranslocoDirective } from '@jsverse/transloco';

/** A side that does not play its first move within this delay aborts the game (server rule). */
const FIRST_MOVE_MS = 30_000;
/** An opponent away for less than this is not shown as gone. */
const AWAY_GRACE_MS = 3_000;

interface Seat {
  color: PlayerColor;
  player: GamePlayer | null;
  remaining: number | null;
  running: boolean;
  /** "+8" or "-8" once a rated game is over. */
  eloChange: string | null;
}

/**
 * Live game. The server owns every rule: a move is only shown ahead of its confirmation while
 * the request is in flight, and the next GAME_STATE or ERROR replaces that preview.
 */
@Component({
  selector: 'app-game-page',
  imports: [
    TranslocoDirective,
    EmptyState,
    CapturedPieces,
    ChessBoard,
    GameChat,
    GameClock,
    Icon,
    MoveList,
    RouterLink,
    UserAvatar,
  ],
  templateUrl: './game-page.html',
  styleUrl: './game-page.css',
})
export class GamePage {
  readonly realtime = inject(GameRealtime);
  private readonly session = inject(AuthSession);
  private readonly games = inject(GamesApi);
  private readonly router = inject(Router);
  private readonly lifecycle = inject(SessionLifecycle);
  private readonly sounds = inject(Sounds);
  private readonly title = inject(PageTitle);
  private readonly toasts = inject(Toasts);
  private readonly challenges = inject(Challenges);
  private readonly document = inject(DOCUMENT);
  readonly preferences = inject(Preferences);
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
  /** With move confirmation on, the move waiting for "Confirm", in the position it was chosen in. */
  readonly unconfirmed = linkedSignal<string | undefined, BoardMove | null>({
    // A new position or the end of the game (flag, resignation) drops it.
    source: () => (this.active() ? this.game()?.board.fen : undefined),
    computation: () => null,
  });
  /** "Nf3": the move waiting for confirmation, as the move list will show it. */
  readonly unconfirmedText = computed(() => {
    const move = this.unconfirmed();
    const fen = this.game()?.board.fen;
    if (!move || !fen) return '';
    try {
      return sanOf(parseFen(fen), {
        from: move.from,
        to: move.to,
        promotion: move.promotion ? (move.promotion[0].toLowerCase() as PromotionType) : undefined,
      });
    } catch {
      return `${move.from}-${move.to}`;
    }
  });
  readonly rematching = signal(false);

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
    const unconfirmed = this.unconfirmed();
    if (unconfirmed && this.myTurn()) {
      try {
        return fenAfter(game.board.fen, unconfirmed);
      } catch {
        return game.board.fen;
      }
    }
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
    const unconfirmed = this.unconfirmed();
    if (unconfirmed && this.myTurn()) return unconfirmed;
    const proposed = this.proposed();
    if (this.previewing() && proposed) return proposed.move;
    const last = this.moves().at(-1);
    return last ? { from: last.from, to: last.to } : null;
  });
  readonly canPlay = computed(
    () =>
      this.myTurn() &&
      !this.unconfirmed() &&
      !this.realtime.pending() &&
      this.realtime.transport.state() === 'connected',
  );
  /** A move may be queued during the opponent's turn, unless the player turned that off. */
  readonly premoves = computed(
    () => this.preferences.premoves() && this.active() && !!this.myColor() && !this.myTurn(),
  );
  /** Elo this game won or lost for the player, once a rated game is over. */
  readonly eloChange = computed(() => {
    const changes = this.game()?.ratingChanges;
    const color = this.myColor();
    if (!changes || !color) return null;
    return color === 'WHITE' ? changes.white : changes.black;
  });
  /** The player's rating as the server shows it now, after the game. */
  readonly myRating = computed(() => {
    const game = this.game();
    const color = this.myColor();
    return (color === 'WHITE' ? game?.whitePlayer : game?.blackPlayer)?.elo ?? null;
  });
  /** Read out to screen readers: the last move, in words. */
  readonly announcement = computed(() => {
    const last = this.moves().at(-1);
    if (!last?.notation) return '';
    return spokenMove(last.notation, last.number % 2 === 1 ? 'WHITE' : 'BLACK');
  });
  /** The opponent, for a rematch: a person, or the bot with its level. */
  readonly opponent = computed(() => {
    const game = this.game();
    const color = this.myColor();
    if (!game || !color) return null;
    return (color === 'WHITE' ? game.blackPlayer : game.whitePlayer) ?? null;
  });

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
  /** After a refused offer, the same side waits a few moves before offering again. */
  readonly canOfferDraw = computed(() => {
    const game = this.game();
    const color = this.myColor();
    if (!game || !color || this.bot() || game.drawOffer) return false;
    const from = game.drawOfferAllowedFrom?.[color === 'WHITE' ? 'white' : 'black'] ?? 0;
    return this.moves().length >= from;
  });
  /**
   * Threefold repetition or fifty moves without capture or pawn move: the player to move may
   * claim the draw. The server confirms the claim with the rules engine.
   */
  readonly drawClaimable = computed(() => {
    const game = this.game();
    if (!game || !this.myTurn()) return false;
    if (game.board.halfmoveClock >= 100) return true;
    return repetitions(game.initialFen ?? START_FEN, this.moves()) >= 3;
  });
  /** Before both sides have moved, a player aborts instead of resigning: nothing is rated. */
  readonly canAbort = computed(() => this.active() && !!this.myColor() && this.moves().length < 2);
  /** "0:24" left for the side to move to play its first move, between two people. */
  readonly firstMoveLeft = computed(() => {
    const game = this.game();
    if (!game || game.status !== 'ACTIVE' || this.bot() || this.moves().length >= 2) return null;
    const since = Date.parse(this.moves().at(-1)?.timestamp ?? game.startedAt ?? '');
    if (!Number.isFinite(since)) return null;
    return Math.max(0, since + FIRST_MOVE_MS - this.serverNow());
  });
  /** The opponent left the game; the claim opens one minute after they left. */
  readonly opponentAway = computed(() => {
    const game = this.game();
    const me = this.me();
    if (!game || game.status !== 'ACTIVE' || !this.myColor() || !me) return null;
    const entry = (game.away ?? []).find((away) => away.playerId !== me);
    // A short grace: a reload, or an opponent still opening the game, is not news.
    const now = this.serverNow();
    if (!entry || now - Date.parse(entry.since) < AWAY_GRACE_MS) return null;
    const left = Math.max(0, Date.parse(entry.claimableAt) - now);
    return { left, claimable: left === 0 };
  });
  readonly watchers = computed(() => trCount('game.watchers', this.spectators()));
  readonly format = formatClock;
  /** The server's time now, as far as the last clock sync tells: deadlines are the server's. */
  private serverNow(): number {
    return this.now() + this.realtime.serverSkew();
  }
  /** "Rated · 10 + 0", "Casual · 3 + 2" or "Against the computer · 5 + 0". */
  readonly kind = computed(() => {
    const game = this.game();
    if (!game) return '';
    const label = timeControlLabel(game.timeControl);
    if (this.bot()) return tr('game.kindBot', { control: label });
    return tr('game.kind', {
      kind: tr(game.rated ? 'common.rated' : 'common.casual'),
      control: label,
    });
  });

  readonly headline = computed(() => {
    const game = this.game();
    if (!game) return '';
    if (game.status === 'WAITING') return tr('game.waitingOpponent');
    if (game.status === 'FINISHED') return this.outcome();
    if (!this.myColor()) return tr('game.toMove', { side: tr(`game.sides.${game.board.turn}`) });
    if (this.botFailed()) return tr('game.botCouldNot');
    if (this.botThinking()) return tr('game.botThinking');
    if (this.myTurn()) return tr(this.previewing() ? 'game.sending' : 'game.yourTurn');
    return tr('game.opponentTurn');
  });

  /** The analysis board opens on the position the game reached. */
  readonly analysisLink = computed(() => ({ fen: this.game()?.board.fen ?? START_FEN }));

  readonly link = computed(() =>
    this.browser ? `${location.origin}/game/${this.gameId()}` : `/game/${this.gameId()}`,
  );

  readonly connection = computed(() => {
    switch (this.realtime.transport.state()) {
      case 'connecting':
      case 'authenticating':
        return tr('game.connecting');
      case 'reconnecting':
        return tr('game.reconnecting');
      case 'unavailable':
        return tr('game.offline');
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
    // "Your move" in the tab title, so a player in another tab knows.
    effect(() =>
      this.title.status.set(this.myTurn() && !this.previewing() ? tr('game.yourMove') : null),
    );
    this.soundsAndRating();
    if (this.browser) {
      const timer = setInterval(() => this.now.set(Date.now()), 200);
      inject(DestroyRef).onDestroy(() => clearInterval(timer));
    }
    inject(DestroyRef).onDestroy(() => {
      this.title.status.set(null);
      this.realtime.leave();
    });
  }

  /**
   * Sounds for each new move and for the end of the game, and a fresh header rating once a
   * game this player was in is over. Nothing plays for the moves already there on arrival.
   */
  private soundsAndRating(): void {
    let seen: { id: string; plies: number; status: string } | null = null;
    effect(() => {
      const game = this.game();
      if (!game) return;
      const plies = game.moves.length;
      const before = seen?.id === game.id ? seen : null;
      seen = { id: game.id, plies, status: game.status };
      if (!before) return;
      untracked(() => {
        if (game.status === 'FINISHED' && before.status !== 'FINISHED') {
          this.sounds.play('end');
          if (this.myColor()) this.lifecycle.refreshUser().subscribe({ error: () => undefined });
        } else if (game.status === 'ACTIVE' && before.status === 'WAITING') {
          this.sounds.play('notify');
        } else if (plies > before.plies) {
          this.sounds.play(moveSound(game.moves[plies - 1].notation));
        }
      });
    });
  }

  play(move: BoardMove): void {
    const game = this.game();
    if (!game || !this.canPlay()) return;
    if (this.preferences.confirmMoves()) {
      this.unconfirmed.set(move);
      return;
    }
    this.send(move);
  }

  /** Sends the move kept for confirmation. */
  confirmMove(): void {
    const move = this.unconfirmed();
    this.unconfirmed.set(null);
    if (move && this.canPlay()) this.send(move);
  }

  private send(move: BoardMove): void {
    const game = this.game();
    if (game && this.realtime.move(move.from, move.to, move.promotion))
      this.proposed.set({ base: game.board.fen, move });
  }

  /**
   * Another game against the same opponent: the bot at the same level with the colours
   * swapped, or a person challenged with the same time control and rating choice.
   */
  rematch(): void {
    const game = this.game();
    const opponent = this.opponent();
    const color = this.myColor();
    if (!game || !opponent || !color || this.rematching()) return;
    this.rematching.set(true);
    const failed = (error: unknown) => {
      this.rematching.set(false);
      this.toasts.error(errorText(error, tr('game.rematchFailed')));
    };
    if (opponent.botDifficulty) {
      this.games
        .createBot({
          difficulty: opponent.botDifficulty,
          color: color === 'WHITE' ? 'BLACK' : 'WHITE',
          timeControl: game.timeControl,
        })
        .subscribe({
          next: ({ gameId }) => {
            this.rematching.set(false);
            void this.router.navigate(['/game', gameId]);
          },
          error: failed,
        });
      return;
    }
    this.challenges
      .send(opponent.id, { timeControl: game.timeControl, rated: !!game.rated })
      .subscribe({ next: () => this.rematching.set(false), error: failed });
  }

  /** The game as PGN, for any chess program. */
  pgn(): string {
    const game = this.game();
    return game ? gamePgn(game, this.moves(), this.browser ? location.host : '42 Chess') : '';
  }

  downloadPgn(): void {
    const game = this.game();
    if (!game) return;
    const names = [game.whitePlayer, game.blackPlayer].map((player) =>
      player?.botDifficulty ? 'computer' : (player?.username ?? 'player'),
    );
    downloadPgn(this.pgn(), `42chess_${names.join('_vs_')}_${game.id.slice(0, 8)}`, this.document);
  }

  async copyPgn(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.pgn());
      this.toasts.success(tr('game.pgnCopied'));
    } catch {
      this.toasts.error(tr('game.pgnFailed'));
    }
  }

  abort(): void {
    this.confirmingResign.set(false);
    this.realtime.abort();
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
        this.retryError.set(tr('game.botStillDown'));
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

  /** A human player shown with their picture; a bot or an empty seat has none. */
  person(player: GamePlayer | null): GamePlayer | null {
    return player && !player.botDifficulty ? player : null;
  }

  name(player: GamePlayer | null): string {
    if (!player) return tr('game.waitingPlayer');
    if (player.botDifficulty) return botName(player.botDifficulty);
    return player.id === this.me()
      ? tr('game.you', { name: player.username })
      : displayName(player.username);
  }

  /** Leaves the spectator room for the list of live games. */
  stopWatching(): void {
    this.realtime.leave();
    void this.router.navigate(['/live']);
  }

  private open(id: string, watch: boolean): void {
    this.proposed.set(null);
    this.unconfirmed.set(null);
    this.rematching.set(false);
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
    const synced = this.realtime.clockSynced() ? this.realtime.displayClocks() : null;
    if (synced) {
      // Projected from the server time; corrects the delay since the server read the clock.
      remaining = color === 'WHITE' ? synced.white : synced.black;
    } else if (clocks) {
      // Until the first sync, count down from when the last clock value arrived.
      remaining = color === 'WHITE' ? clocks.white : clocks.black;
      if (running) remaining -= this.now() - this.realtime.clocksAt();
      remaining = Math.max(0, remaining);
    }
    const changes = game?.ratingChanges;
    const change = changes ? (color === 'WHITE' ? changes.white : changes.black) : null;
    const eloChange = change === null ? null : change > 0 ? `+${change}` : String(change);
    return { color, player, remaining, running, eloChange };
  }

  private outcome(): string {
    const result = this.game()?.result;
    return result ? resultText(result, this.myColor()) : tr('game.over');
  }
}
