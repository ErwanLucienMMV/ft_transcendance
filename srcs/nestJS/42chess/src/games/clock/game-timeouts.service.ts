import { Injectable, Logger, Optional } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Game } from '../game.entity.js';
import { GameStoreService } from '../game-store.service.js';
import { GameClocksService } from './game-clocks.service.js';
import { FIRST_MOVE_SECONDS, GamesService } from '../games.service.js';

/** Open invitations are removed after this many hours. */
export const WAITING_GAME_TTL_HOURS = 24;

/** Durable deadlines are discovered again after restart; no per-game timer owns state. */
@Injectable()
export class GameTimeoutsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameTimeoutsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private ticks = 0;
  constructor(
    private readonly store: GameStoreService,
    private readonly clocks: GameClocksService,
    @Optional() private readonly games?: GamesService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (!this.pending) {
        const tick = this.ticks++;
        this.pending = this.run(tick)
          .catch((error: unknown) =>
            this.logger.error(
              'Game timeout sweep failed',
              error instanceof Error ? error.stack : String(error),
            ),
          )
          .finally(() => {
            this.pending = undefined;
          });
      }
    }, 1000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
  }

  private async run(tick: number): Promise<void> {
    await this.sweep();
    if (tick % 5 === 0) await this.sweepAborts();
    if (tick % 60 === 0) await this.expireWaiting();
  }

  async sweep(): Promise<void> {
    for (const id of await this.store.dueClocks()) {
      try {
        await this.store.tryLocked(id, async (manager, state) => {
          if (await this.clocks.settle(manager, state.game))
            await manager.save(Game, state.game);
        });
      } catch (error) {
        this.logger.error(
          `Cannot settle game ${id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /** Games between two people where the side to move never played its first move. */
  async sweepAborts(): Promise<void> {
    if (!this.games) return;
    for (const id of await this.store.dueAborts(FIRST_MOVE_SECONDS)) {
      try {
        await this.games.abortIfDue(id);
      } catch (error) {
        this.logger.error(
          `Cannot abort game ${id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  async expireWaiting(): Promise<void> {
    const removed = await this.store.expireWaiting(WAITING_GAME_TTL_HOURS);
    if (removed) this.logger.log(`Removed ${removed} expired invitations.`);
  }
}
