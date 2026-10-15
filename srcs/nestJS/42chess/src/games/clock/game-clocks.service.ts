import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { GameClock } from './game-clock.js';
import type { ClockSnapshot, PlayerColor } from './game-clock.js';
import type { Game } from '../game.entity.js';
import { GameError } from '../game-error.js';
import { finishGame } from '../game-actions.js';

export interface PersistentClock extends ClockSnapshot {
  readonly updatedAt: number;
}

/** PostgreSQL wall time provides one shared, restart-safe time base for all instances. */
@Injectable()
export class GameClocksService {
  initialize(game: Game): void {
    game.clock = { ...new GameClock(game).getSnapshot(0), updatedAt: 0 };
    game.clockDeadline = null;
  }

  async start(manager: EntityManager, game: Game): Promise<void> {
    const now = await this.now(manager);
    const clock = new GameClock(game);
    clock.start(now, game.turn);
    this.checkpoint(game, clock, now);
  }

  /** Returns true when expiry ends the game; that result must commit, not throw. */
  async settle(manager: EntityManager, game: Game): Promise<boolean> {
    if (game.status !== 'ACTIVE') return false;
    const clock = this.restore(game);
    const expiryAt =
      game.clock!.updatedAt +
      game.clock![game.turn === 'WHITE' ? 'white' : 'black'];
    // A backwards wall-clock adjustment cannot restore consumed time.
    const now = Math.max(await this.now(manager), game.clock!.updatedAt);
    const state = clock.getSnapshot(now);
    this.checkpoint(game, clock, now);
    if (state.status !== 'EXPIRED') return false;
    finishGame(
      game,
      state.expiredColor === 'WHITE' ? 'BLACK_WIN' : 'WHITE_WIN',
      'TIMEOUT',
    );
    game.finishedAt = new Date(Math.max(expiryAt, game.startedAt!.getTime()));
    return true;
  }

  async move(
    manager: EntityManager,
    game: Game,
    color: PlayerColor,
  ): Promise<void> {
    const clock = this.restore(game);
    const acceptedAt = game.clock!.updatedAt;
    clock.completeMove(color, acceptedAt);
    // Rule validation is server work: it charges neither player. The next clock
    // starts when that work finishes, with the mover charged up to the lock time.
    const now = Math.max(await this.now(manager), acceptedAt);
    const snapshot = clock.getSnapshot(acceptedAt);
    game.clock = { ...snapshot, updatedAt: now };
    this.deadline(game);
  }

  stop(game: Game): void {
    const clock = this.restore(game);
    const now = game.clock!.updatedAt;
    clock.stop(now);
    this.checkpoint(game, clock, now);
    game.finishedAt = new Date(now);
  }

  private restore(game: Game): GameClock {
    try {
      if (
        !game.clock ||
        (game.status === 'ACTIVE' &&
          (game.clock.status !== 'RUNNING' ||
            game.clock.activeColor !== game.turn))
      )
        throw new Error('Clock does not match the active game.');
      return GameClock.restore(game, game.clock, game.clock.updatedAt);
    } catch (cause) {
      throw new GameError(
        'INVALID_CLOCK_STATE',
        'The stored game clock is inconsistent.',
        { cause },
      );
    }
  }

  private async now(manager: EntityManager): Promise<number> {
    const [row]: { now: Date }[] = await manager.query(
      'SELECT clock_timestamp() AS now',
    );
    return row.now.getTime();
  }

  private checkpoint(game: Game, clock: GameClock, now: number): void {
    game.clock = { ...clock.getSnapshot(now), updatedAt: now };
    this.deadline(game);
  }

  private deadline(game: Game): void {
    const state = game.clock!;
    game.clockDeadline =
      state.status === 'RUNNING'
        ? new Date(
            state.updatedAt +
              state[state.activeColor === 'WHITE' ? 'white' : 'black'],
          )
        : null;
  }
}
