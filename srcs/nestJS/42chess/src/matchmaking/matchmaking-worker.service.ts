import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service.js';

/** Each replica may poll; PostgreSQL serializes the matching transactions. */
@Injectable()
export class MatchmakingWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MatchmakingWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  constructor(private readonly matchmaking: MatchmakingService) {}
  onApplicationBootstrap(): void {
    this.start();
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
    this.timer.unref();
  }
  async tick(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        // Bound work per tick, without starving later queue entries.
        for (let i = 0; i < 20; ++i)
          if (!(await this.matchmaking.matchNext())) break;
      } catch {
        this.logger.warn(
          'Matching failed; durable waiting entries will be retried.',
        );
      }
    })();
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.pending;
  }
  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }
}
