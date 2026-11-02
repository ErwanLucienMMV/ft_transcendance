import {
  registerMatchWaitMetrics,
  WAIT_BUCKETS,
} from './match-wait-metrics.js';
import { MetricsService } from './metrics.service.js';
import type { DataSource } from 'typeorm';

describe('Retained match wait distribution', () => {
  const metrics = new MetricsService();
  beforeEach(() => metrics.registry.clear());
  afterEach(() => metrics.registry.clear());
  it('shares one SQL snapshot, rebinds collectors, exports fixed cumulative buckets and resets on purge', async () => {
    let count = 2;
    const source = {
      query: vi.fn(async () => [
        {
          count,
          sum: count * 5,
          ...Object.fromEntries(
            WAIT_BUCKETS.map((limit, index) => [
              `b${index}`,
              limit < 5 ? 0 : count,
            ]),
          ),
        },
      ]),
    };
    registerMatchWaitMetrics(source as unknown as DataSource, metrics);
    const first = await metrics.registry.metrics();
    expect(source.query).toHaveBeenCalledTimes(1);
    expect(first).toContain('matchmaking_wait_seconds_bucket{le="1"} 0');
    expect(first).toContain('matchmaking_wait_seconds_bucket{le="5"} 2');
    expect(first).toContain('matchmaking_wait_seconds_bucket{le="+Inf"} 2');
    expect(first).toContain('matchmaking_wait_seconds_count 2');
    expect(first).toContain('matchmaking_wait_seconds_sum 10');
    expect(await metrics.registry.metrics()).toEqual(first);
    count = 0;
    registerMatchWaitMetrics(
      source as unknown as DataSource,
      new MetricsService(),
    );
    expect(await metrics.registry.metrics()).toContain(
      'matchmaking_wait_seconds_count 0',
    );
  });
});
