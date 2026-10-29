import { DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthSession } from '../auth/auth-session';
import { GameClockSync, type ClockSample } from './game-clock-sync';
import { RealtimeService } from './realtime.service';

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
export interface GameSnapshot {
  id: string;
  gameId: string;
  status: 'WAITING' | 'ACTIVE' | 'FINISHED';
  whitePlayer: {
    id: string;
    username: string;
    avatarUrl: string | null;
    elo: number;
    color: PlayerColor;
  } | null;
  blackPlayer: {
    id: string;
    username: string;
    avatarUrl: string | null;
    elo: number;
    color: PlayerColor;
  } | null;
  timeControl: { initialTime: number; increment: number };
  board: { fen: string; turn: PlayerColor; halfmoveClock: number; fullmoveNumber: number };
  clocks: { white: number; black: number } | null;
  serverTime?: string | null;
  clockStatus?: 'WAITING' | 'RUNNING' | 'STOPPED' | 'EXPIRED';
  result: { winner: PlayerColor | null; reason: string | null } | null;
  drawOffer: { playerId: string } | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  moves: GameMove[];
}

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
  /** Smooth display in milliseconds; never used to decide a move, timeout or result. */
  readonly displayClocks = signal<{ white: number; black: number } | null>(null);
  private readonly clock = new GameClockSync();
  private syncRequest: { id: number; sent: number } | null = null;
  private requestSequence = 0;
  private lastSync = -Infinity;
  readonly error = signal<{ code: string; message: string } | null>(null);

  constructor() {
    const timer = setInterval(() => {
      if (this.transport.state() === 'connected')
        this.displayClocks.set(this.clock.project(performance.now()));
    }, 100);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    effect(() => {
      if (this.transport.state() !== 'connected') {
        this.clock.reset();
        this.syncRequest = null;
        this.lastSync = -Infinity;
      }
    });
    effect(() => {
      const id = this.watched();
      if (this.transport.state() === 'connected' && id && id !== this.subscribed) {
        if (this.transport.joinGame(id)) this.subscribed = id;
      }
    });
    effect(() => {
      const token = this.session.token();
      const userId = this.session.user()?.id ?? null;
      untracked(() => this.follow(token, userId));
    });
    this.transport.events.pipe(takeUntilDestroyed()).subscribe((packet) => {
      if (packet.event === 'ERROR') {
        this.error.set({
          code: typeof packet.data['code'] === 'string' ? packet.data['code'] : 'REALTIME_ERROR',
          message: 'The game request could not be completed.',
        });
        return;
      }
      if (packet.data['gameId'] !== this.watched()) return;
      if (packet.event === 'GAME_STATE') {
        const value = packet.data as unknown as GameSnapshot;
        if (
          value.id === value.gameId &&
          ['WAITING', 'ACTIVE', 'FINISHED'].includes(value.status) &&
          typeof value.board?.fen === 'string' &&
          Array.isArray(value.moves)
        ) {
          this.game.set(value);
          if (value.status !== 'ACTIVE') this.clock.reset();
          const accepted = this.clock.accept({
            ...packet.data,
            turn: value.board.turn,
          } as unknown as ClockSample);
          this.displayClocks.set(this.clock.project(performance.now()) ?? value.clocks);
          if (accepted) this.requestSync();
          this.error.set(null);
        }
      } else if (packet.event === 'CLOCK_SYNC') {
        const pending = this.syncRequest;
        if (
          this.game()?.status === 'ACTIVE' &&
          pending &&
          packet.data['requestId'] === pending.id
        ) {
          this.syncRequest = null;
          this.clock.synchronize(
            packet.data as unknown as ClockSample,
            pending.sent,
            performance.now(),
            Number(packet.data['processingMs']),
            Number(packet.data['sampleAgeMs']),
          );
          this.displayClocks.set(this.clock.project(performance.now()));
        }
      } else if (packet.event === 'CLOCK_UPDATE') {
        const clocks = packet.data['clocks'] as { white: number; black: number } | null;
        if (this.game()?.status === 'FINISHED') return;
        if (
          clocks &&
          clocks.white >= 0 &&
          clocks.black >= 0 &&
          Number.isFinite(clocks.white) &&
          Number.isFinite(clocks.black)
        ) {
          if (
            packet.data['serverTime'] !== undefined &&
            !this.clock.accept(packet.data as unknown as ClockSample)
          )
            return;
          this.displayClocks.set(this.clock.project(performance.now()) ?? clocks);
          this.requestSync();
          this.game.update((game) => (game ? { ...game, clocks } : null));
        }
      }
    });
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
    this.clock.reset();
    this.syncRequest = null;
    this.lastSync = -Infinity;
    this.displayClocks.set(null);
    this.error.set(null);
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
  private requestSync(): void {
    const gameId = this.watched();
    const now = performance.now();
    if (!gameId || this.game()?.status !== 'ACTIVE' || now - this.lastSync < 10000) return;
    const requestId = ++this.requestSequence;
    if (this.transport.send('SYNC_CLOCK', { gameId, requestId })) {
      this.syncRequest = { id: requestId, sent: now };
      this.lastSync = now;
    }
  }
  private command(event: string, data: Record<string, unknown> = {}): boolean {
    const gameId = this.watched();
    if (!gameId || this.game()?.status !== 'ACTIVE') return false;
    this.error.set(null);
    return this.transport.send(event, { ...data, gameId });
  }
}
