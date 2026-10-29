import { Injectable } from '@nestjs/common';

/**
 * Spectators per game, kept by the realtime rooms of this process and read by
 * GET /games/live. Rooms are in memory too, so both stay consistent per instance.
 */
@Injectable()
export class SpectatorRegistry {
  private readonly counts = new Map<string, number>();

  set(gameId: string, count: number): void {
    if (count > 0) this.counts.set(gameId, count);
    else this.counts.delete(gameId);
  }

  count(gameId: string): number {
    return this.counts.get(gameId) ?? 0;
  }
}
