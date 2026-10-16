import { gameFixture, INITIAL_FEN } from './game-service.fixture.js';
import { User } from '../dist/users/user.entity.js';
import { Game } from '../dist/games/game.entity.js';
import { RatingHistory } from '../dist/rating/rating-history.entity.js';
import { RatingService } from '../dist/rating/rating.service.js';
import { GameStoreService } from '../dist/games/game-store.service.js';
import { GameTimeoutsService } from '../dist/games/clock/game-timeouts.service.js';
import { GameClocksService } from '../dist/games/clock/game-clocks.service.js';
import { finishGame } from '../dist/games/game-actions.js';
import type { GameEndReason } from '../dist/games/game.entity.js';

describe('Atomic game completion and rating (SCRUM-211)', () => {
  const f = gameFixture();
  afterEach(() => vi.restoreAllMocks());

  async function history(id: string) {
    return f.source.manager.findBy(RatingHistory, { gameId: id });
  }
  async function accounts() {
    return f.source.manager.find(User, { order: { id: 'ASC' } });
  }
  async function assertRated(id: string) {
    const state = await f.service.get(id);
    const rows = await history(id);
    expect(rows).toHaveLength(2);
    for (const player of state.players) {
      const actual =
        state.game.result === 'DRAW'
          ? 0.5
          : state.game.result === `${player.color}_WIN`
            ? 1
            : 0;
      const user = await f.source.manager.findOneByOrFail(User, {
        id: player.userId,
      });
      expect(user).toMatchObject({
        gamesPlayed: 1,
        gamesWon: Number(actual === 1),
        gamesDraw: Number(actual === 0.5),
        gamesLost: Number(actual === 0),
      });
      expect(rows.find((row) => row.userId === user.id)?.ratingAfter).toBe(
        user.elo,
      );
    }
  }
  async function overdue(id: string) {
    const { game } = await f.service.get(id);
    await f.source.query(
      `UPDATE games SET clock=$1, "clockDeadline"=now()-interval '1 second' WHERE id=$2`,
      [{ ...game.clock, white: 1, updatedAt: Date.now() - 10000 }, id],
    );
  }
  function worker() {
    return new GameTimeoutsService(
      new GameStoreService(f.source, new RatingService()),
      new GameClocksService(),
    );
  }

  it('rates checkmate from the engine-normalized standard initial position', async () => {
    const { game } = await f.active();
    expect(game.initialFen).toBe(INITIAL_FEN);
    const ended = await f.playLine(game.id, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect(ended.game).toMatchObject({
      status: 'FINISHED',
      result: 'BLACK_WIN',
      endReason: 'CHECKMATE',
    });
    await assertRated(game.id);
  });

  it('rates resignation only once across retries and terminal reads', async () => {
    const { game } = await f.active();
    await f.service.resign(f.black, game.id);
    await expect(f.service.resign(f.white, game.id)).rejects.toMatchObject({
      code: 'GAME_ALREADY_FINISHED',
    });
    await f.service.settle(game.id);
    await f.service.settle(game.id);
    await assertRated(game.id);
  });

  it('rates a draw agreement even when both adjustments are zero', async () => {
    const { game } = await f.active();
    await f.service.offerDraw(f.white, game.id);
    await f.service.acceptDraw(f.black, game.id);
    expect((await history(game.id)).map((row) => row.change)).toEqual([0, 0]);
    await assertRated(game.id);
  });

  it('rates a valid repetition claim confirmed by the real engine', async () => {
    const { game } = await f.active();
    const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    await f.playLine(game.id, [...cycle, ...cycle]);
    await f.service.claimDraw(f.white, game.id, 'THREEFOLD_REPETITION');
    await assertRated(game.id);
  });

  it.each([
    'STALEMATE',
    'INSUFFICIENT_MATERIAL',
    'FIFTY_MOVE_RULE',
  ] as GameEndReason[])(
    'applies the shared rating policy to a standard-start %s result',
    async (reason) => {
      const { game } = await f.active();
      const store = new GameStoreService(f.source, new RatingService());
      await store.locked(game.id, async (manager, state) => {
        finishGame(state.game, 'DRAW', reason);
        new GameClocksService().stop(state.game);
        await manager.save(Game, state.game);
      });
      await assertRated(game.id);
    },
  );

  it.each([
    ['7k/5K2/8/6Q1/8/8/8/8 w - - 0 1', 'g5g6', 'STALEMATE'],
    ['7k/8/8/8/8/8/1r6/K1B5 w - - 0 1', 'c1b2', 'INSUFFICIENT_MATERIAL'],
  ])(
    'preserves real-engine %s custom-position completion without rating it',
    async (fen, move, reason) => {
      const { game } = await f.active(fen);
      const before = await accounts();
      const ended = await f.service.play(f.white, game.id, move);
      expect(ended.game).toMatchObject({
        status: 'FINISHED',
        result: 'DRAW',
        endReason: reason,
      });
      expect(await history(game.id)).toEqual([]);
      expect(await accounts()).toEqual(before);
    },
  );

  it('preserves a custom-position fifty-move claim without rating it', async () => {
    const { game } = await f.active('7k/8/8/8/8/8/R7/K7 w - - 100 51');
    await f.service.claimDraw(f.white, game.id, 'FIFTY_MOVE');
    expect((await f.service.get(game.id)).game.endReason).toBe(
      'FIFTY_MOVE_RULE',
    );
    expect(await history(game.id)).toEqual([]);
  });

  it.each(['settle', 'play'] as const)(
    'rates timeout discovered during %s',
    async (action) => {
      const { game } = await f.active();
      await overdue(game.id);
      if (action === 'settle') await f.service.settle(game.id);
      else await f.service.play(f.white, game.id, 'e2e4');
      expect((await f.service.get(game.id)).game.endReason).toBe('TIMEOUT');
      await assertRated(game.id);
    },
  );

  it('rates background expiry after a worker restart without an HTTP request', async () => {
    const { game } = await f.active();
    await overdue(game.id);
    await worker().sweep();
    await worker().sweep();
    expect((await f.service.get(game.id)).game.endReason).toBe('TIMEOUT');
    await assertRated(game.id);
  });

  it('serializes concurrent terminal actions and applies exactly one result', async () => {
    const { game } = await f.active();
    const results = await Promise.allSettled([
      f.service.resign(f.white, game.id),
      f.service.resign(f.black, game.id),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { code: 'GAME_ALREADY_FINISHED' } });
    await assertRated(game.id);
  });

  it('rolls back the final move, board, clocks, ratings, and statistics on history failure', async () => {
    const { game } = await f.active();
    const before = await f.playLine(game.id, ['f2f3', 'e7e5', 'g2g4']);
    const users = await accounts();
    await f.source
      .query(`CREATE FUNCTION fail_rating_history() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected history failure'; END $$`);
    await f.source.query(
      'CREATE TRIGGER fail_rating_history BEFORE INSERT ON rating_history FOR EACH ROW EXECUTE FUNCTION fail_rating_history()',
    );
    try {
      await expect(f.service.play(f.black, game.id, 'd8h4')).rejects.toThrow(
        'Injected history failure',
      );
      expect(await f.service.get(game.id)).toEqual(before);
      expect(await accounts()).toEqual(users);
      expect(await history(game.id)).toEqual([]);
    } finally {
      await f.source.query(
        'DROP TRIGGER fail_rating_history ON rating_history',
      );
      await f.source.query('DROP FUNCTION fail_rating_history()');
    }
    await f.service.play(f.black, game.id, 'd8h4');
    await assertRated(game.id);
  });

  it('keeps a failed background completion durable for a subsequent worker retry', async () => {
    const { game } = await f.active();
    await overdue(game.id);
    const before = await f.service.get(game.id);
    const failure = vi
      .spyOn(RatingService.prototype, 'applyFinishedGame')
      .mockRejectedValueOnce(new Error('Injected rating outage'));
    try {
      await worker().sweep();
    } finally {
      failure.mockRestore();
    }
    expect(await f.service.get(game.id)).toEqual(before);
    expect(await history(game.id)).toEqual([]);
    await worker().sweep();
    await assertRated(game.id);
  });
});
