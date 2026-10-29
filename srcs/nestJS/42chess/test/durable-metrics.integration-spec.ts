import { DataSource } from 'typeorm';
import { gameFixture, INITIAL_FEN } from './game-service.fixture.js';
import { GamesMetricsService } from '../dist/games/games-metrics.service.js';
import { MetricsService } from '../dist/metrics/metrics.service.js';

describe('Committed observability inventories (SCRUM-428..431)', () => {
  const fixture = gameFixture();
  const metrics = new MetricsService();
  beforeEach(() => {
    metrics.registry.clear();
    new GamesMetricsService(fixture.source, metrics);
  });
  afterEach(() => metrics.registry.clear());
  const scrape = () => metrics.registry.metrics();
  async function populate() {
    const [game] = await fixture.source.query(`INSERT INTO games
      (status,"initialTime","startedAt","finishedAt",result)
      VALUES ('FINISHED',300000,now(),now(),'DRAW') RETURNING id`);
    await fixture.source.query(
      `INSERT INTO matchmaking_matches
      ("gameId","matchedAt","whiteWaitSeconds","blackWaitSeconds") VALUES ($1,now(),1,10)`,
      [game.id],
    );
    await fixture.source.query(
      `INSERT INTO matchmaking_queue
      ("userId",rating,"initialTime",status) VALUES ($1,1000,300000,'WAITING'),
      ($2,1000,300000,'CANCELLED'),($3,1000,300000,'MATCHED')`,
      [fixture.white, fixture.black, fixture.outsider],
    );
    const [puzzle] = await fixture.source.query(
      `INSERT INTO puzzles (fen,solution)
      VALUES ($1,ARRAY['e2e4']) RETURNING id`,
      [INITIAL_FEN],
    );
    await fixture.source.query(
      `INSERT INTO puzzle_attempts ("userId","puzzleId",solved,attempts)
      VALUES ($1,$2,true,1),($1,$2,false,3)`,
      [fixture.white, puzzle.id],
    );
    return game.id;
  }
  it('counts only actual retained states and never accumulates repeated scrape observations', async () => {
    await populate();
    const output = await scrape();
    expect(output).toContain('games_finished 1');
    expect(output).toContain('puzzle_move_submissions 4');
    expect(output).toContain('matchmaking_queue_size 1');
    expect(output).toContain('puzzle_attempts{outcome="solved"} 1');
    expect(output).toContain('puzzle_attempts{outcome="unsolved"} 1');
    expect(output).toContain('matchmaking_wait_seconds_count 2');
    expect(output).toContain('matchmaking_wait_seconds_sum 11');
    expect(output).toContain('matchmaking_wait_seconds_bucket{le="1"} 1');
    expect(output).toContain('matchmaking_wait_seconds_bucket{le="10"} 2');
    expect(output).toContain('matchmaking_wait_seconds_bucket{le="+Inf"} 2');
    expect(await scrape()).toEqual(output);
    expect(output).not.toMatch(/userId|gameId|token|email/);
  });
  it('excludes uncommitted and rolled back writes, then reflects purge without stale values', async () => {
    const id = await populate();
    const before = await scrape();
    await expect(
      fixture.source.transaction(async (manager) => {
        await manager.query(`INSERT INTO games
        (status,"initialTime","startedAt","finishedAt",result)
        VALUES ('FINISHED',300000,now(),now(),'DRAW')`);
        expect(await scrape()).toEqual(before);
        throw new Error('rollback probe');
      }),
    ).rejects.toThrow('rollback probe');
    expect(await scrape()).toEqual(before);
    await fixture.source.query('DELETE FROM games WHERE id=$1', [id]);
    await fixture.source.query('DELETE FROM puzzle_attempts');
    await fixture.source.query(
      "UPDATE matchmaking_queue SET status='CANCELLED'",
    );
    const purged = await scrape();
    for (const name of [
      'games_finished',
      'puzzle_move_submissions',
      'matchmaking_queue_size',
      'matchmaking_wait_seconds_count',
      'matchmaking_wait_seconds_sum',
    ])
      expect(purged).toContain(`${name} 0`);
    expect(purged).toContain('puzzle_attempts{outcome="solved"} 0');
    expect(purged).toContain('puzzle_attempts{outcome="unsolved"} 0');
    expect(purged).toContain('matchmaking_wait_seconds_bucket{le="+Inf"} 0');
  });
  it('rebinds after restart and agrees across independent database connections', async () => {
    await populate();
    const expected = await scrape();
    for (let index = 0; index < 2; index++) {
      const replica = new DataSource(fixture.source.options);
      await replica.initialize();
      try {
        new GamesMetricsService(replica, new MetricsService());
        expect(await scrape()).toEqual(expected);
      } finally {
        await replica.destroy();
      }
    }
    new GamesMetricsService(fixture.source, metrics);
    expect(await scrape()).toEqual(expected);
  });
});
