import { MetricsService } from './metrics.service.js';

describe('Shared metrics registry', () => {
  const metrics = new MetricsService();

  beforeEach(() => metrics.registry.clear());
  afterEach(() => metrics.registry.clear());

  it('shares reusable instruments between feature providers without duplicate registration', async () => {
    const anotherProvider = new MetricsService();
    const counter = {
      name: 'test_events_total',
      help: 'Test events',
      labelNames: ['outcome'] as const,
    };
    const gauge = { name: 'test_connections', help: 'Test connections' };
    const histogram = {
      name: 'test_duration_seconds',
      help: 'Test duration',
      buckets: [0.1, 1],
    };

    const events = metrics.counter(counter);
    events.inc({ outcome: 'success' });
    expect(anotherProvider.counter(counter)).toBe(events);
    metrics.gauge(gauge).set(3);
    expect(anotherProvider.gauge(gauge)).toBe(metrics.gauge(gauge));
    metrics.histogram(histogram).observe(0.25);
    expect(anotherProvider.histogram(histogram)).toBe(
      metrics.histogram(histogram),
    );

    const output = await metrics.registry.metrics();
    expect(output).toContain('test_events_total{outcome="success"} 1');
    expect(output).toContain('test_connections 3');
    expect(output).toContain('test_duration_seconds_sum 0.25');
  });

  it('rejects conflicting metric types instead of returning the wrong instrument', () => {
    metrics.counter({ name: 'test_conflict', help: 'Counter' });
    expect(() =>
      metrics.gauge({ name: 'test_conflict', help: 'Gauge' }),
    ).toThrow('different type');
    expect(() =>
      metrics.histogram({ name: 'test_conflict', help: 'Histogram' }),
    ).toThrow('different type');
  });
});
