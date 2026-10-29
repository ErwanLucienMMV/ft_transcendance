import { randomUUID } from 'node:crypto';
import { ratingFixture } from './rating.fixture.js';
import { User } from '../dist/users/user.entity.js';
import { RatingHistory } from '../dist/rating/rating-history.entity.js';
import { calculateGameRatings } from '../dist/rating/elo-calculation.js';
import type { GameResult } from '../dist/games/game.entity.js';
import { Game } from '../dist/games/game.entity.js';
import { GamePlayer } from '../dist/games/game-player.entity.js';

describe('Transactional rating persistence (SCRUM-212, SCRUM-214)', () => {
  const f = ratingFixture();

  it.each(['WHITE_WIN', 'BLACK_WIN', 'DRAW'] as GameResult[])(
    'persists both snapshots and statistics for %s',
    async (result) => {
      const [white, black] = await f.users();
      const state = await f.finished(white, black, result);
      expect(await f.apply(state)).toBe('APPLIED');
      const rows = await f.source.manager.findBy(RatingHistory, {
        gameId: state.game.id,
      });
      expect(rows).toHaveLength(2);
      const score = result === 'DRAW' ? 0.5 : result === 'WHITE_WIN' ? 1 : 0;
      const expected = calculateGameRatings({
        ratingA: 1200,
        ratingB: 1200,
        scoreA: score,
      });
      for (const [user, rating, actual] of [
        [white, expected.a, score],
        [black, expected.b, 1 - score],
      ] as const) {
        expect(rows.find((row) => row.userId === user.id)).toMatchObject({
          ...rating,
          gameId: state.game.id,
        });
        expect(
          await f.source.manager.findOneByOrFail(User, { id: user.id }),
        ).toMatchObject({
          elo: rating.ratingAfter,
          gamesPlayed: 1,
          gamesWon: Number(actual === 1),
          gamesDraw: Number(actual === 0.5),
          gamesLost: Number(actual === 0),
        });
      }
    },
  );

  it('is idempotent even after a participant has played another game', async () => {
    const [white, black] = await f.users();
    const first = await f.finished(white, black);
    await f.apply(first);
    await f.apply(await f.finished(white, black, 'BLACK_WIN'));
    const before = await f.snapshot();
    expect(await f.apply(first)).toBe('ALREADY_APPLIED');
    expect(await f.snapshot()).toEqual(before);
  });

  it('serializes simultaneous processing of the same game', async () => {
    const [white, black] = await f.users();
    const state = await f.finished(white, black);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => f.apply(state)),
    );
    expect(results.filter((result) => result === 'APPLIED')).toHaveLength(1);
    expect(
      results.filter((result) => result === 'ALREADY_APPLIED'),
    ).toHaveLength(5);
    const snapshot = await f.snapshot();
    expect(snapshot.history).toHaveLength(2);
    expect(snapshot.users.map((user) => user.gamesPlayed)).toEqual([1, 1]);
  });

  it('does not lose updates across concurrent games sharing a player', async () => {
    const [shared, second] = await f.users();
    const [third] = await f.users();
    const first = await f.finished(shared, second);
    const other = await f.finished(third, shared, 'BLACK_WIN');
    await Promise.all([f.apply(first), f.apply(other)]);
    const history = await f.source.manager.findBy(RatingHistory, {
      userId: shared.id,
    });
    expect(history).toHaveLength(2);
    expect(
      history.map((row) => row.ratingBefore).sort((a, b) => a - b),
    ).toEqual([1200, 1216]);
    const user = await f.source.manager.findOneByOrFail(User, {
      id: shared.id,
    });
    expect(user).toMatchObject({
      elo: 1231,
      gamesPlayed: 2,
      gamesWon: 2,
      gamesDraw: 0,
      gamesLost: 0,
    });
    expect(await f.source.manager.count(RatingHistory)).toBe(4);
  });

  it('locks user rows in deterministic UUID order, independent of seat order', async () => {
    const users = await f.users();
    users.sort((a, b) => (a.id < b.id ? 1 : -1));
    const state = await f.finished(users[0], users[1]);
    await f.source.transaction(async (manager) => {
      const spy = vi.spyOn(manager, 'findOne');
      try {
        await f.ratings.applyFinishedGame(manager, state.game, state.players);
        const locks = spy.mock.calls
          .filter((call) => call[0] === User)
          .map((call) => call[1]);
        expect(locks.map((options) => options.where)).toEqual([
          { id: users[1].id },
          { id: users[0].id },
        ]);
        expect(locks.map((options) => options.lock?.mode)).toEqual([
          'pessimistic_write',
          'pessimistic_write',
        ]);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('rolls back both user updates when history insertion fails, then permits retry', async () => {
    const [white, black] = await f.users();
    const state = await f.finished(white, black);
    const before = await f.snapshot();
    await expect(
      f.source.transaction(async (manager) => {
        const spy = vi
          .spyOn(manager, 'insert')
          .mockRejectedValueOnce(new Error('Injected history failure'));
        try {
          await f.ratings.applyFinishedGame(manager, state.game, state.players);
        } finally {
          spy.mockRestore();
        }
      }),
    ).rejects.toThrow('Injected history failure');
    expect(await f.snapshot()).toEqual(before);
    expect(await f.apply(state)).toBe('APPLIED');
  });

  it('retains database enforcement of the unique user/game pair', async () => {
    const [white, black] = await f.users();
    const state = await f.finished(white, black);
    await f.apply(state);
    await expect(
      f.source.manager.insert(RatingHistory, {
        userId: white.id,
        gameId: state.game.id,
        ratingBefore: 1200,
        ratingAfter: 1216,
      }),
    ).rejects.toMatchObject({
      driverError: { code: '23505', constraint: 'UQ_rating_history_0' },
    });
    expect(await f.source.manager.count(RatingHistory)).toBe(2);
  });

  it.each(['partial', 'wrong-user', 'wrong-rating'] as const)(
    'rejects %s history without further updates',
    async (kind) => {
      const [white, black] = await f.users();
      const state = await f.finished(white, black);
      await f.source.manager.insert(RatingHistory, {
        gameId: state.game.id,
        userId: white.id,
        ratingBefore: 1200,
        ratingAfter: 1216,
      });
      if (kind !== 'partial') {
        const [outsider] = await f.users();
        await f.source.manager.insert(RatingHistory, {
          gameId: state.game.id,
          userId: kind === 'wrong-user' ? outsider.id : black.id,
          ratingBefore: 1200,
          ratingAfter: 999,
        });
      }
      const before = await f.snapshot();
      await expect(f.apply(state)).rejects.toMatchObject({
        code: 'INCONSISTENT_RATING_HISTORY',
      });
      expect(await f.snapshot()).toEqual(before);
    },
  );

  it.each([
    'missing',
    'duplicate-user',
    'duplicate-color',
    'wrong-game',
    'wrong-user',
    'invalid-id',
  ] as const)('rejects %s participants', async (kind) => {
    const [white, black] = await f.users();
    const state = await f.finished(white, black);
    const players = state.players.map((player) =>
      Object.assign(new GamePlayer(), player),
    );
    if (kind === 'missing') players.pop();
    if (kind === 'duplicate-user') players[1].userId = players[0].userId;
    if (kind === 'duplicate-color') players[1].color = players[0].color;
    if (kind === 'wrong-game') players[1].gameId = randomUUID();
    if (kind === 'wrong-user') players[1].userId = randomUUID();
    if (kind === 'invalid-id') players[1].userId = 'invalid';
    const before = await f.snapshot();
    await expect(f.apply({ ...state, players })).rejects.toMatchObject({
      code: 'INVALID_RATING_PARTICIPANTS',
    });
    expect(await f.snapshot()).toEqual(before);
  });

  it('requires an existing transaction', async () => {
    const [white, black] = await f.users();
    const { game, players } = await f.finished(white, black);
    await expect(
      f.ratings.applyFinishedGame(f.source.manager, game, players),
    ).rejects.toMatchObject({ code: 'RATING_TRANSACTION_REQUIRED' });
    expect(await f.source.manager.count(RatingHistory)).toBe(0);
  });

  it.each([
    'active',
    'missing-result',
    'changed-result',
    'invalid-time',
  ] as const)('rejects %s game state', async (kind) => {
    const [white, black] = await f.users();
    const state = await f.finished(white, black);
    const game = Object.assign(new Game(), state.game);
    if (kind === 'active') game.status = 'ACTIVE';
    if (kind === 'missing-result') game.result = null;
    if (kind === 'changed-result') game.result = 'BLACK_WIN';
    if (kind === 'invalid-time') game.finishedAt = new Date(NaN);
    await expect(f.apply({ ...state, game })).rejects.toMatchObject({
      code: 'INVALID_RATING_GAME',
    });
    expect(await f.source.manager.count(RatingHistory)).toBe(0);
  });

  it('leaves custom-position games unrated', async () => {
    const [white, black] = await f.users();
    const state = await f.finished(
      white,
      black,
      'WHITE_WIN',
      '8/8/8/8/8/2k5/8/K7 w - - 0 1',
    );
    const before = await f.snapshot();
    expect(await f.apply(state)).toBe('UNRATED');
    expect(await f.snapshot()).toEqual(before);
  });
});
