import { registerDurableMetrics } from './durable-metrics.js';
import { MetricsService } from './metrics.service.js';
import type { DataSource } from 'typeorm';

describe('Durable inventory collectors', () => {
  const metrics = new MetricsService();
  beforeEach(() => metrics.registry.clear());
  afterEach(() => metrics.registry.clear());
  it('replaces snapshots on repeated scrapes and provider rebuild without PII labels', async () => {
    let count = 3;
    const source = {
      query: vi.fn(async (sql: string) =>
        sql.includes('GROUP BY solved')
          ? [{ solved: true, value: count }]
          : [{ value: count }],
      ),
    };
    registerDurableMetrics(source as unknown as DataSource, metrics);
    const first = await metrics.registry.metrics();
    expect(first).toContain('games_finished 3');
    expect(first).toContain('puzzle_attempts{outcome="solved"} 3');
    expect(first).toContain('puzzle_attempts{outcome="unsolved"} 0');
    expect(await metrics.registry.metrics()).toEqual(first);
    count = 0;
    registerDurableMetrics(
      source as unknown as DataSource,
      new MetricsService(),
    );
    const purged = await metrics.registry.metrics();
    expect(purged).toContain('games_finished 0');
    expect(purged).toContain('matchmaking_queue_size 0');
    expect(purged).not.toMatch(/userId|gameId|token|email/);
  });
  it('fails the scrape on database failure instead of publishing fabricated zeroes', async () => {
    registerDurableMetrics(
      {
        query: vi.fn().mockRejectedValue(new Error('database offline')),
      } as unknown as DataSource,
      metrics,
    );
    await expect(metrics.registry.metrics()).rejects.toThrow(
      'database offline',
    );
  });
});
