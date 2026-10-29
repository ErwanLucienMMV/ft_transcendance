import type { DataSource } from 'typeorm';
import type { MetricsService } from './metrics.service.js';

export const WAIT_BUCKETS = [0.1, 1, 5, 10, 30, 60, 120, 300, 600] as const;

/** Gauge histogram of retained committed matches; never use rate() on this inventory. */
export function registerMatchWaitMetrics(
  source: DataSource,
  metrics: MetricsService,
): void {
  type Snapshot = { count: number; sum: number } & Record<string, number>;
  let pending: Promise<Snapshot> | undefined;
  const snapshot = (): Promise<Snapshot> => {
    if (!pending) {
      const buckets = WAIT_BUCKETS.map(
        (limit, index) =>
          `count(*) FILTER (WHERE seconds <= ${limit})::float8 AS b${index}`,
      );
      pending = source
        .query(
          `SELECT count(*)::float8 AS count,
        COALESCE(sum(seconds),0)::float8 AS sum, ${buckets.join(', ')}
        FROM (SELECT "whiteWaitSeconds" AS seconds FROM matchmaking_matches
          UNION ALL SELECT "blackWaitSeconds" FROM matchmaking_matches) observations`,
        )
        .then(([row]: Snapshot[]) => row)
        .finally(() => {
          pending = undefined;
        });
    }
    return pending;
  };
  metrics.gauge({
    name: 'matchmaking_wait_seconds_bucket',
    help: 'Cumulative buckets of player wait seconds in retained committed matches (gauge inventory)',
    labelNames: ['le'] as const,
    async collect() {
      const row = await snapshot();
      WAIT_BUCKETS.forEach((limit, index) =>
        this.set({ le: String(limit) }, row[`b${index}`]),
      );
      this.set({ le: '+Inf' }, row.count);
    },
  });
  for (const part of ['count', 'sum'] as const) {
    metrics.gauge({
      name: `matchmaking_wait_seconds_${part}`,
      help: `Retained committed player wait ${part === 'count' ? 'observation count' : 'seconds sum'} (gauge inventory)`,
      async collect() {
        this.set((await snapshot())[part]);
      },
    });
  }
}
