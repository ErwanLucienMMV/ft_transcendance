import { gameFixture } from './game-service.fixture.js';
import { GameTimeoutsService } from '../dist/games/clock/game-timeouts.service.js';
import { GameStoreService } from '../dist/games/game-store.service.js';
import { GameClocksService } from '../dist/games/clock/game-clocks.service.js';
import { RatingService } from '../dist/rating/rating.service.js';

const CYCLE = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];

describe('Game end rules, rated games and invitations', () => {
  const f = gameFixture();

  async function overdue(id: string) {
    const { game } = await f.service.get(id);
    await f.source.query(
      `UPDATE games SET clock=$1, "clockDeadline"=now()-interval '1 second' WHERE id=$2`,
      [{ ...game.clock, white: 1, updatedAt: Date.now() - 10000 }, id],
    );
  }
  async function ratingRows(id: string) {
    return f.source.query('SELECT * FROM rating_history WHERE "gameId"=$1', [
      id,
    ]);
  }
  function sweeper() {
    const store = new GameStoreService(f.source, new RatingService());
    return new GameTimeoutsService(store, new GameClocksService(), f.service);
  }

  describe('automatic draws (FIDE 9.6)', () => {
    it('ends the game at the fifth occurrence of a position', async () => {
      const { game } = await f.active();
      const fourth = await f.playLine(game.id, [...CYCLE, ...CYCLE, ...CYCLE]);
      expect(fourth.game.status).toBe('ACTIVE');
      const state = await f.playLine(game.id, CYCLE);
      expect(state.game).toMatchObject({
        status: 'FINISHED',
        result: 'DRAW',
        endReason: 'FIVEFOLD_REPETITION',
      });
      expect(await ratingRows(game.id)).toHaveLength(2);
    });

    it('ends the game after seventy-five moves without capture or pawn move', async () => {
      const { game } = await f.active('7k/8/8/8/8/8/R7/K7 w - - 149 120');
      const state = await f.playLine(game.id, ['a2a3']);
      expect(state.game).toMatchObject({
        status: 'FINISHED',
        result: 'DRAW',
        endReason: 'SEVENTY_FIVE_MOVE_RULE',
      });
    });

    it('lets the player to move claim a draw without naming the rule', async () => {
      const { game } = await f.active();
      await f.playLine(game.id, [...CYCLE, ...CYCLE]);
      const state = await f.service.claimDraw(f.white, game.id);
      expect(state.game).toMatchObject({
        result: 'DRAW',
        endReason: 'THREEFOLD_REPETITION',
      });
    });
  });

  it('draws on time when the opponent cannot checkmate (FIDE 6.9)', async () => {
    // Black has a lone king: White running out of time cannot lose.
    const { game } = await f.active('7k/8/8/8/8/8/R7/K7 w - - 0 1');
    await overdue(game.id);
    const state = await f.service.settle(game.id);
    expect(state.game).toMatchObject({
      status: 'FINISHED',
      result: 'DRAW',
      endReason: 'TIMEOUT',
    });
  });

  describe('aborted games', () => {
    it('lets a player abort before both sides moved, without rating', async () => {
      const { game } = await f.active();
      await f.playLine(game.id, ['e2e4']);
      const state = await f.service.abort(f.black, game.id);
      expect(state.game).toMatchObject({
        status: 'FINISHED',
        result: null,
        endReason: 'ABORTED',
      });
      expect(await ratingRows(game.id)).toEqual([]);
      const [count] = await f.source.query(
        `SELECT "gamesPlayed" FROM users WHERE id = $1`,
        [f.white],
      );
      expect(count.gamesPlayed).toBe(0);
    });

    it('refuses an abort once both sides have moved', async () => {
      const { game } = await f.active();
      await f.playLine(game.id, ['e2e4', 'e7e5']);
      await expect(f.service.abort(f.white, game.id)).rejects.toMatchObject({
        code: 'ABORT_TOO_LATE',
      });
    });

    it('aborts a game whose side to move never played its first move', async () => {
      const { game } = await f.active();
      await f.source.query(
        `UPDATE games SET "startedAt" = now() - interval '31 seconds' WHERE id = $1`,
        [game.id],
      );
      await sweeper().sweepAborts();
      const state = await f.service.get(game.id);
      expect(state.game).toMatchObject({ result: null, endReason: 'ABORTED' });
    });

    it('counts the second first move from the first one, and stops once both played', async () => {
      const backdate = (id: string) =>
        f.source.query(
          `UPDATE moves SET "createdAt" = now() - interval '31 seconds' WHERE "gameId" = $1`,
          [id],
        );
      const one = await f.active();
      await f.playLine(one.game.id, ['e2e4']);
      await backdate(one.game.id);
      await sweeper().sweepAborts();
      expect((await f.service.get(one.game.id)).game).toMatchObject({
        endReason: 'ABORTED',
      });

      const both = await f.active();
      await f.playLine(both.game.id, ['e2e4', 'e7e5']);
      await backdate(both.game.id);
      await sweeper().sweepAborts();
      expect((await f.service.get(both.game.id)).game.status).toBe('ACTIVE');
    });

    it('leaves a game alone while its first-move delay runs', async () => {
      const { game } = await f.active();
      await sweeper().sweepAborts();
      expect((await f.service.get(game.id)).game.status).toBe('ACTIVE');
    });

    it('rejects an aborted row that carries a result', async () => {
      const { game } = await f.active();
      await f.service.abort(f.white, game.id);
      await expect(
        f.source.query(`UPDATE games SET result = 'DRAW' WHERE id = $1`, [
          game.id,
        ]),
      ).rejects.toMatchObject({ driverError: { code: '23514' } });
    });
  });

  describe('abandonment', () => {
    it('gives the win to the player who stayed, with rating', async () => {
      const { game } = await f.active();
      await f.playLine(game.id, ['e2e4', 'e7e5']);
      const state = await f.service.claimAbandonment(f.black, game.id);
      expect(state.game).toMatchObject({
        result: 'BLACK_WIN',
        endReason: 'ABANDONED',
      });
      expect(await ratingRows(game.id)).toHaveLength(2);
    });

    it('aborts instead when the game had not really started', async () => {
      const { game } = await f.active();
      const state = await f.service.claimAbandonment(f.white, game.id);
      expect(state.game).toMatchObject({ result: null, endReason: 'ABORTED' });
    });
  });

  describe('rated and casual games', () => {
    it('keeps games against a friend casual by default', async () => {
      const created = await f.service.create(f.white, {
        initialTime: 300000,
      });
      expect(created.game.rated).toBe(false);
      await f.service.join(f.black, created.game.id);
      const state = await f.service.resign(f.white, created.game.id);
      expect(state.game.result).toBe('BLACK_WIN');
      expect(await ratingRows(created.game.id)).toEqual([]);
    });
  });

  describe('draw offers', () => {
    it('makes a declined player wait a few moves before offering again', async () => {
      const { game } = await f.active();
      await f.service.offerDraw(f.white, game.id);
      await f.service.declineDraw(f.black, game.id);
      await expect(f.service.offerDraw(f.white, game.id)).rejects.toMatchObject(
        { code: 'DRAW_OFFER_TOO_SOON' },
      );
      await f.playLine(game.id, ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
      const state = await f.service.offerDraw(f.white, game.id);
      expect(state.game.drawOffer).toBe('WHITE');
    });
  });

  describe('invitations', () => {
    it('limits open invitations and lets their creator cancel one', async () => {
      const ids: string[] = [];
      for (let index = 0; index < 5; index++)
        ids.push(
          (await f.service.create(f.white, { initialTime: 300000 })).game.id,
        );
      await expect(
        f.service.create(f.white, { initialTime: 300000 }),
      ).rejects.toMatchObject({ code: 'WAITING_GAME_LIMIT' });
      expect((await f.service.waiting(f.white)).map((game) => game.id)).toEqual(
        expect.arrayContaining(ids),
      );
      await expect(f.service.cancel(f.black, ids[0])).rejects.toMatchObject({
        code: 'NOT_A_PLAYER',
      });
      await f.service.cancel(f.white, ids[0]);
      await expect(f.service.get(ids[0])).rejects.toMatchObject({
        code: 'GAME_NOT_FOUND',
      });
      await f.service.create(f.white, { initialTime: 300000 });
    });

    it('does not cancel a game that started', async () => {
      const { game } = await f.active();
      await expect(f.service.cancel(f.white, game.id)).rejects.toMatchObject({
        code: 'GAME_NOT_WAITING',
      });
    });

    it('removes invitations nobody accepted within a day', async () => {
      const old = await f.service.create(f.white, { initialTime: 300000 });
      const fresh = await f.service.create(f.white, { initialTime: 300000 });
      await f.source.query(
        `UPDATE games SET "createdAt" = now() - interval '25 hours' WHERE id = $1`,
        [old.game.id],
      );
      await sweeper().expireWaiting();
      await expect(f.service.get(old.game.id)).rejects.toMatchObject({
        code: 'GAME_NOT_FOUND',
      });
      expect((await f.service.get(fresh.game.id)).game.status).toBe('WAITING');
    });

    it('starts only one of two invitations of the same creator opened at once', async () => {
      const first = await f.service.create(f.outsider, { initialTime: 300000 });
      const second = await f.service.create(f.outsider, {
        initialTime: 300000,
      });
      const results = await Promise.allSettled([
        f.service.join(f.white, first.game.id),
        f.service.join(f.black, second.game.id),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { response: { code: 'ACTIVE_GAME_EXISTS' } },
      });
    });

    it('refuses to start a second game for a player who is already playing', async () => {
      await f.active();
      const invitation = await f.service.create(f.outsider, {
        initialTime: 300000,
      });
      await expect(
        f.service.join(f.black, invitation.game.id),
      ).rejects.toMatchObject({
        response: { code: 'ACTIVE_GAME_EXISTS' },
      });
    });
  });

  it('reads clocks without writing the game row', async () => {
    const { game } = await f.active();
    const [before] = await f.source.query(
      'SELECT "updatedAt", clock FROM games WHERE id = $1',
      [game.id],
    );
    const observed = await f.service.observe(game.id);
    await f.service.settle(game.id);
    const [after] = await f.source.query(
      'SELECT "updatedAt", clock FROM games WHERE id = $1',
      [game.id],
    );
    expect(after).toEqual(before);
    expect(observed.game.clock.updatedAt).toBeGreaterThanOrEqual(
      before.clock.updatedAt,
    );
  });
});
