import { DataSource } from 'typeorm';
import { gameFixture } from './game-service.fixture.js';
import { GamesMetricsService } from '../dist/games/games-metrics.service.js';
import { MetricsService } from '../dist/metrics/metrics.service.js';

describe('Durable active-game metrics', () => {
  const fixture = gameFixture();
  const metrics = new MetricsService();

  beforeEach(() => {
    metrics.registry.clear();
    new GamesMetricsService(fixture.source, metrics);
  });
  afterEach(() => metrics.registry.clear());

  const scrape = () => metrics.registry.metrics();

  it('exports an unlabelled zero when no active games exist', async () => {
    const output = await scrape();
    expect(output).toContain('# TYPE games_active gauge\ngames_active 0');
    expect(output).not.toContain('games_active{');
  });

  it('counts only ACTIVE persisted games and refreshes changes made by another connection', async () => {
    await fixture.source.query(`INSERT INTO games
      (status, "initialTime", "startedAt", "finishedAt", result)
      VALUES ('WAITING', 300000, NULL, NULL, NULL),
             ('ACTIVE', 300000, now(), NULL, NULL),
             ('ACTIVE', 300000, now(), NULL, NULL),
             ('FINISHED', 300000, now(), now(), 'DRAW')`);
    expect(await scrape()).toContain('\ngames_active 2\n');

    // Independent process / replica finishes games without notifying this app.
    const replica = new DataSource(fixture.source.options);
    await replica.initialize();
    try {
      await replica.query(`UPDATE games SET status='FINISHED',
        "finishedAt"=now(), result='DRAW' WHERE status='ACTIVE'`);
      expect(await scrape()).toContain('\ngames_active 0\n');

      await replica.query(`UPDATE games SET status='ACTIVE',
        "startedAt"=now() WHERE status='WAITING'`);
      expect(await scrape()).toContain('\ngames_active 1\n');
    } finally {
      await replica.destroy();
    }
  });

  it('recovers the database count after rebuilding the collector', async () => {
    await fixture.source.query(`INSERT INTO games
      (status, "initialTime", "startedAt") VALUES ('ACTIVE', 300000, now())`);
    expect(await scrape()).toContain('\ngames_active 1\n');

    metrics.registry.clear();
    const restarted = new MetricsService();
    new GamesMetricsService(fixture.source, restarted);
    expect(await restarted.registry.metrics()).toContain('\ngames_active 1\n');
  });
});
