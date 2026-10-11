import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Game } from '../game.entity.js';
import { GameStoreService } from '../game-store.service.js';
import { GameClocksService } from './game-clocks.service.js';

/** Durable deadlines are discovered again after restart; no per-game timer owns state. */
@Injectable()
export class GameTimeoutsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameTimeoutsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  constructor(
    private readonly store: GameStoreService,
    private readonly clocks: GameClocksService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (!this.pending) {
        this.pending = this.sweep()
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
}
