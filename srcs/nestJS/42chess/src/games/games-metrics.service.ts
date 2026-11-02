import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MetricsService } from '../metrics/metrics.service.js';
import { Game } from './game.entity.js';
import { registerDurableMetrics } from '../metrics/durable-metrics.js';
import { registerMatchWaitMetrics } from '../metrics/match-wait-metrics.js';

/** Durable game counts are refreshed at scrape time, including after restarts. */
@Injectable()
export class GamesMetricsService {
  constructor(source: DataSource, metrics: MetricsService) {
    registerDurableMetrics(source, metrics);
    registerMatchWaitMetrics(source, metrics);
    metrics.gauge({
      name: 'games_active',
      help: 'Number of active games in the shared database',
      async collect() {
        // Read the shared state so every game path and application replica agrees.
        this.set(
          await source.getRepository(Game).countBy({ status: 'ACTIVE' }),
        );
      },
    });
  }
}
