import { gameFixture } from './game-service.fixture.js';
import { GameStoreService } from '../dist/games/game-store.service.js';
import { GameClocksService } from '../dist/games/clock/game-clocks.service.js';
import { GameTimeoutsService } from '../dist/games/clock/game-timeouts.service.js';
import { AddGameClocks1791741000000 } from '../dist/database/migrations/1791741000000-AddGameClocks.js';

describe('Persistent game clocks and timeouts', () => {
  const f = gameFixture();

  it('keeps migrated clock constraints when generating future schema changes', async () => {
    const plan = await f.source.driver.createSchemaBuilder().log();
    const droppedClockChecks = plan.upQueries.filter((query) =>
      /DROP CONSTRAINT "CHK_games_clock(?:_deadline)?"/.test(query.query),
    );
    expect(droppedClockChecks).toEqual([]);
  });

  async function overdue(id: string, color: 'WHITE' | 'BLACK' = 'WHITE') {
    const { game } = await f.service.get(id);
    const clock = {
      ...game.clock,
      white: color === 'WHITE' ? 0 : 5000,
      black: color === 'BLACK' ? 0 : 5000,
      activeColor: color,
      status: 'RUNNING',
      expiredColor: null,
      updatedAt: Date.now() - 10000,
    };
    // A positive stored balance expires after elapsed time, not by client declarations.
    if (color === 'WHITE') clock.white = 1;
    else clock.black = 1;
    await f.source.query(
      'UPDATE games SET "clock" = $1, "clockDeadline" = now() - interval \'1 second\', "turn" = $2 WHERE id=$3',
      [clock, color, id],
    );
  }

  it('initializes both clocks in WAITING and starts only when the second player joins', async () => {
    const { game } = await f.service.create(f.white, {
      initialTime: 60000,
      increment: 2000,
    });
    expect(game.clock).toMatchObject({
      white: 60000,
      black: 60000,
      status: 'WAITING',
      activeColor: null,
    });
    expect(game.clockDeadline).toBeNull();
    const state = await f.service.join(f.black, game.id);
    expect(state.game.clock).toMatchObject({
      white: 60000,
      black: 60000,
      status: 'RUNNING',
      activeColor: 'WHITE',
    });
    expect(state.game.clockDeadline).toBeInstanceOf(Date);
  });

  it('starts Black for custom black-to-move positions', async () => {
    const { game } = await f.active(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1',
    );
    expect(game.clock!.activeColor).toBe('BLACK');
  });

  it('restores remaining time across service instances, charges the mover and grants increment once', async () => {
    const { game } = await f.active();
    const [row]: { now: Date }[] = await f.source.query(
      'SELECT clock_timestamp() AS now',
    );
    const record = {
      ...game.clock,
      white: 10000,
      black: 20000,
      updatedAt: row.now.getTime() - 1000,
    };
    await f.source.query('UPDATE games SET clock=$1 WHERE id=$2', [
      record,
      game.id,
    ]);
    const played = await f.service.play(f.white, game.id, 'e2e4');
    expect(played.game.clock!.white).toBeGreaterThan(10000);
    expect(played.game.clock!.white).toBeLessThanOrEqual(11000);
    expect(played.game.clock!.black).toBe(20000);
    expect(played.game.clock!.activeColor).toBe('BLACK');
    const reloaded = await f.service.get(game.id);
    expect(reloaded.game.clock).toEqual(played.game.clock);
    // A second clock service restores solely from PostgreSQL, as after restart.
    const store = new GameStoreService(f.source);
    await store.locked(game.id, async (manager, state) => {
      const clocks = new GameClocksService();
      await clocks.settle(manager, state.game);
      await manager.save('Game', state.game);
    });
    const settled = await f.service.get(game.id);
    expect(settled.game.clock!.white).toBe(played.game.clock!.white);
    expect(settled.game.clock!.black).toBeLessThanOrEqual(20000);
  });

  it.each(['WHITE', 'BLACK'] as const)(
    'ends on %s timeout without appending a late move or increment',
    async (color) => {
      const { game } = await f.active();
      await overdue(game.id, color);
      const ended = await f.service.play(
        color === 'WHITE' ? f.white : f.black,
        game.id,
        color === 'WHITE' ? 'e2e4' : 'e7e5',
      );
      expect(ended.game).toMatchObject({
        status: 'FINISHED',
        result: color === 'WHITE' ? 'BLACK_WIN' : 'WHITE_WIN',
        endReason: 'TIMEOUT',
        clockDeadline: null,
      });
      expect(ended.game.clock).toMatchObject({
        status: 'EXPIRED',
        expiredColor: color,
        activeColor: null,
      });
      expect(ended.game.clock![color === 'WHITE' ? 'white' : 'black']).toBe(0);
      expect(ended.moves).toEqual([]);
      expect(await f.service.settle(game.id)).toEqual(ended);
    },
  );

  it.each(['offerDraw', 'acceptDraw', 'resign'] as const)(
    'gives an already elapsed timeout priority over %s',
    async (method) => {
      const { game } = await f.active();
      await f.service.offerDraw(f.white, game.id);
      await overdue(game.id);
      const ended = await f.service[method](f.black, game.id);
      expect(ended.game).toMatchObject({
        result: 'BLACK_WIN',
        endReason: 'TIMEOUT',
        drawOffer: null,
      });
    },
  );

  it('settles an expired game without a move, once across competing connections', async () => {
    const { game } = await f.active();
    await overdue(game.id);
    const results = await Promise.all([
      f.service.settle(game.id),
      f.service.settle(game.id),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].game.endReason).toBe('TIMEOUT');
    expect(results[0].moves).toEqual([]);
  });

  it('discovers overdue persisted deadlines after restart without any player request', async () => {
    const { game } = await f.active();
    await overdue(game.id);
    const sweeper = new GameTimeoutsService(
      new GameStoreService(f.source),
      new GameClocksService(),
    );
    await sweeper.sweep();
    const ended = await f.service.get(game.id);
    expect(ended.game).toMatchObject({
      status: 'FINISHED',
      endReason: 'TIMEOUT',
      result: 'BLACK_WIN',
    });
    await sweeper.sweep();
    expect(await f.service.get(game.id)).toEqual(ended);
  });

  it('freezes remaining balances on resignation and does not charge terminal games', async () => {
    const { game } = await f.active();
    const ended = await f.service.resign(f.black, game.id);
    expect(ended.game.clock!.status).toBe('STOPPED');
    expect(ended.game.clockDeadline).toBeNull();
    expect(await f.service.settle(game.id)).toEqual(ended);
  });

  it('leaves clocks unchanged when an illegal move fails', async () => {
    const before = await f.active();
    await expect(
      f.service.play(f.white, before.game.id, 'e2e5'),
    ).rejects.toMatchObject({ code: 'ILLEGAL_MOVE' });
    expect(await f.service.get(before.game.id)).toEqual(before);
  });

  it('rejects corrupted or absent ACTIVE clock state rather than granting fresh time', async () => {
    const { game } = await f.active();
    await f.source.query('UPDATE games SET clock=NULL WHERE id=$1', [game.id]);
    await expect(f.service.settle(game.id)).rejects.toMatchObject({
      code: 'INVALID_CLOCK_STATE',
    });
    expect((await f.service.get(game.id)).game.status).toBe('ACTIVE');
  });

  it('does not hold up other expired games when one parent is already locked', async () => {
    const first = await f.active();
    const second = await f.active();
    await overdue(first.game.id);
    await overdue(second.game.id);
    const runner = f.source.createQueryRunner();
    await runner.startTransaction();
    await runner.query('SELECT id FROM games WHERE id=$1 FOR UPDATE', [
      first.game.id,
    ]);
    const sweeper = new GameTimeoutsService(
      new GameStoreService(f.source),
      new GameClocksService(),
    );
    const sweep = sweeper.sweep();
    let timer: ReturnType<typeof setTimeout>;
    try {
      const completed = await Promise.race([
        sweep.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 1000);
        }),
      ]);
      expect(completed).toBe(true);
      expect((await f.service.get(second.game.id)).game.endReason).toBe(
        'TIMEOUT',
      );
      expect((await f.service.get(first.game.id)).game.status).toBe('ACTIVE');
    } finally {
      clearTimeout(timer!);
      await runner.rollbackTransaction();
      await runner.release();
      await sweep;
    }
  });

  it('uses database time to finish even when an application instance clock is behind', async () => {
    const { game } = await f.active();
    const { vi } = await import('vitest');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    try {
      const ended = await f.service.resign(f.white, game.id);
      expect(ended.game.result).toBe('BLACK_WIN');
      expect(ended.game.finishedAt!.getTime()).toBeGreaterThanOrEqual(
        game.startedAt!.getTime(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not charge server rule-validation latency to either player', async () => {
    const { game } = await f.active();
    const [row]: { now: Date }[] = await f.source.query(
      'SELECT clock_timestamp() AS now',
    );
    await f.source.query('UPDATE games SET clock=$1 WHERE id=$2', [
      { ...game.clock, white: 500, updatedAt: row.now.getTime() },
      game.id,
    ]);
    const { vi } = await import('vitest');
    const realMove = f.engine.move.bind(f.engine);
    const engine = vi
      .spyOn(f.engine, 'move')
      .mockImplementation(async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return realMove(input);
      });
    try {
      const played = await f.service.play(f.white, game.id, 'e2e4');
      expect(played.game.status).toBe('ACTIVE');
      expect(played.game.clock!.white).toBeGreaterThan(2000);
      expect(played.game.clock!.black).toBe(300000);
      expect(played.moves).toHaveLength(1);
    } finally {
      engine.mockRestore();
    }
  });

  it('reaches unlocked expired games beyond a full batch of busy parents', async () => {
    const { game } = await f.active();
    await overdue(game.id);
    const clones: { id: string }[] = await f.source.query(
      `INSERT INTO games
      ("initialTime",increment,status,"startedAt",clock,"clockDeadline")
      SELECT "initialTime",increment,status,"startedAt",clock,"clockDeadline" FROM games,generate_series(1,100) WHERE id=$1 RETURNING id`,
      [game.id],
    );
    const ids = [game.id, ...clones.map((row) => row.id)].sort();
    await f.source.query(
      `INSERT INTO game_players ("gameId","userId",color)
      SELECT game_id,"userId",color FROM unnest($1::uuid[]) AS game_id CROSS JOIN game_players WHERE "gameId"=$2`,
      [clones.map((row) => row.id), game.id],
    );
    const runner = f.source.createQueryRunner();
    await runner.startTransaction();
    await runner.query(
      'SELECT id FROM games WHERE id=ANY($1::uuid[]) FOR UPDATE',
      [ids.slice(0, 100)],
    );
    try {
      const sweeper = new GameTimeoutsService(
        new GameStoreService(f.source),
        new GameClocksService(),
      );
      await sweeper.sweep();
      expect((await f.service.get(ids[100])).game.endReason).toBe('TIMEOUT');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('reapplies clock persistence for waiting games without dropping seats', async () => {
    const { game } = await f.service.create(f.white, { initialTime: 60000 });
    const runner = f.source.createQueryRunner();
    const migration = new AddGameClocks1791741000000();
    try {
      await migration.down(runner);
      expect(await f.count('game_players')).toBe(1);
      await migration.up(runner);
      expect((await f.service.get(game.id)).game.clock).toMatchObject({
        white: 60000,
        black: 60000,
        status: 'WAITING',
      });
    } finally {
      await runner.release();
    }
  });

  it('refuses to invent remaining time when migrating a preexisting active game', async () => {
    const { game } = await f.active();
    const runner = f.source.createQueryRunner();
    const migration = new AddGameClocks1791741000000();
    try {
      await migration.down(runner);
      await expect(migration.up(runner)).rejects.toThrow('Finish active games');
      const [row] = await runner.query('SELECT status FROM games WHERE id=$1', [
        game.id,
      ]);
      expect(row.status).toBe('ACTIVE');
      await runner.query(
        `UPDATE games SET status='FINISHED',result='BLACK_WIN',"finishedAt"=clock_timestamp() WHERE id=$1`,
        [game.id],
      );
      await migration.up(runner);
      expect((await f.service.get(game.id)).game.clock).toBeNull();
    } finally {
      await runner.release();
    }
  });
});
