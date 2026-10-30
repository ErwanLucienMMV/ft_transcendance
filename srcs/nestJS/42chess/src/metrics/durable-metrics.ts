import type { DataSource } from 'typeorm';
import type { MetricsService } from './metrics.service.js';

/** Shared PostgreSQL inventories: never process event counters. */
export function registerDurableMetrics(
  source: DataSource,
  metrics: MetricsService,
): void {
  for (const [name, help, sql] of [
    [
      'games_finished',
      'Retained finished games in the shared database',
      "SELECT count(*)::float8 AS value FROM games WHERE status='FINISHED'",
    ],
    [
      'matchmaking_queue_size',
      'Players currently WAITING in the shared matchmaking queue',
      "SELECT count(*)::float8 AS value FROM matchmaking_queue WHERE status='WAITING'",
    ],
    [
      'puzzle_move_submissions',
      'Submitted moves in retained puzzle sessions; unknown legacy counts excluded',
      'SELECT COALESCE(sum(attempts),0)::float8 AS value FROM puzzle_attempts',
    ],
  ] as const) {
    metrics.gauge({
      name,
      help,
      async collect() {
        const [row]: { value: number }[] = await source.query(sql);
        this.set(row.value);
      },
    });
  }
  metrics.gauge({
    name: 'puzzle_attempts',
    help: 'Retained puzzle attempt sessions by current solved state, not individual submitted moves',
    labelNames: ['outcome'] as const,
    async collect() {
      const rows: { solved: boolean; value: number }[] = await source.query(
        'SELECT solved, count(*)::float8 AS value FROM puzzle_attempts GROUP BY solved',
      );
      this.set(
        { outcome: 'solved' },
        rows.find((row) => row.solved)?.value ?? 0,
      );
      this.set(
        { outcome: 'unsolved' },
        rows.find((row) => !row.solved)?.value ?? 0,
      );
    },
  });
}
