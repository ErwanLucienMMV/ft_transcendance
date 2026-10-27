import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthSession } from '../auth/auth-session';
import { RealtimeService, ServerEvent } from './realtime.service';

export type PlayerColor = 'WHITE' | 'BLACK';
export type Promotion = 'QUEEN' | 'ROOK' | 'BISHOP' | 'KNIGHT';
export interface GameMove {
  number: number;
  playerId: string;
  from: string;
  to: string;
  promotion?: Promotion;
  notation: string | null;
  fen: string;
  timestamp: string;
}
export type BotDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
export interface GamePlayer {
  id: string;
  username: string;
  avatarUrl: string | null;
  elo: number | null;
  color: PlayerColor;
  botDifficulty?: BotDifficulty;
}
export interface GameResult {
  winner: PlayerColor | null;
  reason: string | null;
}
export interface GameSnapshot {
  id: string;
  gameId: string;
  status: 'WAITING' | 'ACTIVE' | 'FINISHED';
  whitePlayer: GamePlayer | null;
  blackPlayer: GamePlayer | null;
  timeControl: { initialTime: number; increment: number };
  board: { fen: string; turn: PlayerColor; halfmoveClock: number; fullmoveNumber: number };
  clocks: { white: number; black: number } | null;
  result: GameResult | null;
  drawOffer: { playerId: string } | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  moves: GameMove[];
  botPending?: boolean;
  botThinking?: boolean;
  botError?: 'BOT_UNAVAILABLE' | 'INVALID_BOT_RESPONSE' | null;
}

/** Server codes the game page can explain; anything else gets the generic message. */
const ERROR_MESSAGES: Record<string, string> = {
  ILLEGAL_MOVE: 'That move is not legal in this position.',
  WRONG_TURN: 'It is not your turn.',
  GAME_NOT_ACTIVE: 'This game is not in progress.',
  GAME_ALREADY_FINISHED: 'This game has already finished.',
  NOT_A_PLAYER: 'Only the players of this game can join it.',
  GAME_NOT_FOUND: 'This game does not exist.',
  GAME_BUSY: 'The bot is still thinking. Try again in a moment.',
  DRAW_ALREADY_OFFERED: 'A draw offer is already pending.',
  DRAW_NOT_OFFERED: 'There is no draw offer to answer.',
  OWN_DRAW_OFFER: 'You cannot answer your own draw offer.',
  BOT_DRAW_UNSUPPORTED: 'The bot does not accept draw offers.',
  BOT_UNAVAILABLE: 'The bot is unavailable right now.',
  TOO_MANY_REQUESTS: 'Too many actions at once. Slow down a little.',
};
const SQUARE = /^[a-h][1-8]$/;

/** View-independent adapter. GAME_STATE remains the authoritative full snapshot. */
@Injectable({ providedIn: 'root' })
export class GameRealtime {
  readonly transport = inject(RealtimeService);
  private readonly session = inject(AuthSession);
  private readonly watched = signal<string | null>(null);
  private subscribed: string | null = null;
  // Session that selected the watched game; the transport drops its rooms when the token changes.
  private owner: { token: string; userId: string } | null = null;
  readonly game = signal<GameSnapshot | null>(null);
  readonly error = signal<{ code: string; message: string } | null>(null);
  /** Local time at which `game().clocks` was last set by the server, for the countdown. */
  readonly clocksAt = signal(0);
  /** A command was sent and its outcome (new state or error) has not arrived yet. */
  readonly pending = signal(false);
  /** The player whose draw offer was just declined, until the game moves on. */
  readonly drawDeclinedBy = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.watched();
      if (this.transport.state() === 'connected' && id && id !== this.subscribed) {
        if (this.transport.joinGame(id)) this.subscribed = id;
      }
    });
    effect(() => {
      // A command lost with its connection never gets an answer; the rejoin brings the state.
      if (this.transport.state() !== 'connected') untracked(() => this.pending.set(false));
    });
    effect(() => {
      const token = this.session.token();
      const userId = this.session.user()?.id ?? null;
      untracked(() => this.follow(token, userId));
    });
    this.transport.events.pipe(takeUntilDestroyed()).subscribe((packet) => this.receive(packet));
  }

  watch(gameId: string): boolean {
    const token = this.session.token();
    const userId = this.session.user()?.id ?? null;
    if (!token || !userId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(gameId))
      return false;
    this.follow(token, userId);
    const id = gameId.toLowerCase();
    if (id === this.watched()) return true;
    this.leave();
    this.watched.set(id);
    this.owner = { token, userId };
    this.transport.connect();
    return true;
  }
  leave(): void {
    const id = this.watched();
    if (id) this.transport.leaveGame(id);
    this.watched.set(null);
    this.subscribed = null;
    this.owner = null;
    this.game.set(null);
    this.error.set(null);
    this.pending.set(false);
    this.drawDeclinedBy.set(null);
  }
  move(from: string, to: string, promotion: Promotion | null = null): boolean {
    return this.command('MAKE_MOVE', { from, to, promotion });
  }
  resign(): boolean {
    return this.command('RESIGN');
  }
  offerDraw(): boolean {
    return this.command('OFFER_DRAW');
  }
  acceptDraw(): boolean {
    return this.command('ACCEPT_DRAW');
  }
  declineDraw(): boolean {
    return this.command('DECLINE_DRAW');
  }
  /** Reconnects after the transport gave up; the watched game is joined again once connected. */
  reconnect(): void {
    this.transport.connect();
  }
  /**
   * Another account, or no account, discards the previous game data. A renewed token for the
   * same user keeps the watched game and sends JOIN_GAME again on the new connection.
   */
  private follow(token: string | null, userId: string | null): void {
    if (!token || !userId || (this.owner && this.owner.userId !== userId)) {
      this.leave();
    } else if (this.owner && this.owner.token !== token) {
      this.owner = { token, userId };
      this.subscribed = null;
    }
  }
  private command(event: string, data: Record<string, unknown> = {}): boolean {
    const gameId = this.watched();
    if (!gameId || this.game()?.status !== 'ACTIVE') return false;
    this.error.set(null);
    const sent = this.transport.send(event, { ...data, gameId });
    if (sent) this.pending.set(true);
    return sent;
  }

  private receive(packet: ServerEvent): void {
    if (packet.event === 'ERROR') {
      // Errors carry no game id; one game is watched at a time, so they belong to it.
      if (!this.watched()) return;
      const code = typeof packet.data['code'] === 'string' ? packet.data['code'] : 'REALTIME_ERROR';
      this.pending.set(false);
      this.error.set({
        code,
        message: ERROR_MESSAGES[code] ?? 'The game request could not be completed.',
      });
      return;
    }
    if (!this.watched() || packet.data['gameId'] !== this.watched()) return;
    switch (packet.event) {
      case 'GAME_STATE': {
        const value = packet.data as unknown as GameSnapshot;
        if (
          value.id === value.gameId &&
          ['WAITING', 'ACTIVE', 'FINISHED'].includes(value.status) &&
          typeof value.board?.fen === 'string' &&
          Array.isArray(value.moves)
        ) {
          this.game.set(value);
          this.clocksAt.set(Date.now());
          this.pending.set(false);
          this.error.set(null);
          if (value.drawOffer) this.drawDeclinedBy.set(null);
        }
        break;
      }
      case 'MOVE_PLAYED':
        this.played(packet.data);
        break;
      case 'CLOCK_UPDATE': {
        const clocks = this.clocks(packet.data['clocks']);
        if (clocks) {
          this.game.update((game) => (game ? { ...game, clocks } : null));
          this.clocksAt.set(Date.now());
        }
        break;
      }
      case 'DRAW_OFFERED': {
        const playerId = packet.data['playerId'];
        if (typeof playerId === 'string') {
          this.drawDeclinedBy.set(null);
          this.game.update((game) => (game ? { ...game, drawOffer: { playerId } } : null));
        }
        break;
      }
      case 'DRAW_DECLINED': {
        const playerId = packet.data['playerId'];
        if (typeof playerId === 'string') {
          this.drawDeclinedBy.set(playerId);
          this.game.update((game) => (game ? { ...game, drawOffer: null } : null));
        }
        break;
      }
      case 'GAME_ENDED': {
        const result = packet.data['result'] as GameResult | null;
        if (result && typeof result === 'object') {
          this.game.update((game) =>
            game ? { ...game, status: 'FINISHED', result, drawOffer: null } : null,
          );
        }
        break;
      }
    }
  }

  /** Applies one announced ply; the GAME_STATE that follows confirms the whole snapshot. */
  private played(data: Record<string, unknown>): void {
    const move = data['move'] as GameMove | undefined;
    const board = data['board'] as GameSnapshot['board'] | undefined;
    if (
      !move ||
      !Number.isSafeInteger(move.number) ||
      !SQUARE.test(move.from) ||
      !SQUARE.test(move.to) ||
      typeof board?.fen !== 'string'
    )
      return;
    const clocks = this.clocks(data['clocks']);
    this.game.update((game) => {
      if (!game || game.moves.some((known) => known.number >= move.number)) return game;
      return {
        ...game,
        board,
        moves: [...game.moves, move],
        clocks: clocks ?? game.clocks,
      };
    });
    if (clocks) this.clocksAt.set(Date.now());
    this.drawDeclinedBy.set(null);
  }

  private clocks(value: unknown): { white: number; black: number } | null {
    const clocks = value as { white: number; black: number } | null;
    return clocks && Number.isFinite(clocks.white) && Number.isFinite(clocks.black) ? clocks : null;
  }
}
