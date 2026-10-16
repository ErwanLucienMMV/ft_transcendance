import { effect, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthSession } from '../auth/auth-session';
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
  readonly game = signal<GameSnapshot | null>(null);
  readonly error = signal<{ code: string; message: string } | null>(null);

  constructor() {
    effect(() => {
      const id = this.watched();
      if (this.transport.state() === 'connected' && id && id !== this.subscribed) {
        if (this.transport.joinGame(id)) this.subscribed = id;
      }
    });
    effect(() => {
      if (!this.session.authenticated()) this.leave();
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
          this.error.set(null);
        }
      } else if (packet.event === 'CLOCK_UPDATE') {
        const clocks = packet.data['clocks'] as { white: number; black: number } | null;
        if (clocks && Number.isFinite(clocks.white) && Number.isFinite(clocks.black)) {
          this.game.update((game) => (game ? { ...game, clocks } : null));
        }
      }
    });
  }

  watch(gameId: string): boolean {
    if (
      !this.session.authenticated() ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(gameId)
    )
      return false;
    const id = gameId.toLowerCase();
    if (id === this.watched()) return true;
    this.leave();
    this.watched.set(id);
    this.transport.connect();
    return true;
  }
  leave(): void {
    const id = this.watched();
    if (id) this.transport.leaveGame(id);
    this.watched.set(null);
    this.subscribed = null;
    this.game.set(null);
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
  private command(event: string, data: Record<string, unknown> = {}): boolean {
    const gameId = this.watched();
    if (!gameId || this.game()?.status !== 'ACTIVE') return false;
    this.error.set(null);
    return this.transport.send(event, { ...data, gameId });
  }
}
