import { vi } from 'vitest';
import { GamesService } from '../dist/games/games.service.js';
import { GameStoreService } from '../dist/games/game-store.service.js';
import { GameRulesService } from '../dist/games/game-rules.service.js';
import { gameFixture, AFTER_E4 } from './game-service.fixture.js';

describe('Authorized and atomic game moves', () => {
  const f = gameFixture();
  afterEach(() => vi.restoreAllMocks());

  it('persists a legal move, its position and the next turn together', async () => {
    const { game } = await f.active();
    const state = await f.service.play(f.white, game.id, 'e2e4');
    expect(state.game).toMatchObject({
      currentFen: AFTER_E4,
      turn: 'BLACK',
      status: 'ACTIVE',
    });
    expect(state.moves).toMatchObject([
      { ply: 1, color: 'WHITE', uci: 'e2e4', fenAfter: AFTER_E4 },
    ]);
    expect(await f.service.get(game.id)).toEqual(state);
  });

  it('loads ordered history and replays initial FEN plus moves only once', async () => {
    const { game } = await f.active();
    const state = await f.playLine(game.id, ['e2e4', 'e7e5', 'g1f3']);
    expect(state.moves.map(({ ply, uci }) => ({ ply, uci }))).toEqual([
      { ply: 1, uci: 'e2e4' },
      { ply: 2, uci: 'e7e5' },
      { ply: 3, uci: 'g1f3' },
    ]);
    expect(state.game.currentFen).toBe(
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
    );
  });

  it('starts with black for an imported black-to-move position', async () => {
    const { game } = await f.active(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1',
    );
    const state = await f.service.play(f.black, game.id, 'e7e5');
    expect(state.moves[0]).toMatchObject({
      color: 'BLACK',
      ply: 1,
      uci: 'e7e5',
    });
    expect(state.game.turn).toBe('WHITE');
  });

  it('rejects a player outside the game', async () => {
    const before = await f.active();
    await expect(
      f.service.play(f.outsider, before.game.id, 'e2e4'),
    ).rejects.toMatchObject({ code: 'NOT_A_PLAYER' });
    expect(await f.service.get(before.game.id)).toEqual(before);
  });

  it('rejects a move out of turn', async () => {
    const before = await f.active();
    await expect(
      f.service.play(f.black, before.game.id, 'e7e5'),
    ).rejects.toMatchObject({ code: 'WRONG_TURN' });
    expect(await f.service.get(before.game.id)).toEqual(before);
  });

  it('rejects moves in a waiting game', async () => {
    const before = await f.service.create(f.white, { initialTime: 60000 });
    await expect(
      f.service.play(f.white, before.game.id, 'e2e4'),
    ).rejects.toMatchObject({ code: 'GAME_NOT_ACTIVE' });
    expect(await f.service.get(before.game.id)).toEqual(before);
  });

  it.each(['e2e5', 'a1a8'])(
    'rejects illegal moves without changing state: %s',
    async (uci) => {
      const before = await f.active();
      await expect(
        f.service.play(f.white, before.game.id, uci),
      ).rejects.toMatchObject({ code: 'ILLEGAL_MOVE' });
      expect(await f.service.get(before.game.id)).toEqual(before);
    },
  );

  it.each(['E2E4', 'e2e2', 'e2e9', 'a7a8k', '', null])(
    'rejects malformed UCI moves: %s',
    async (uci) => {
      const before = await f.active();
      await expect(
        f.service.play(f.white, before.game.id, uci as never),
      ).rejects.toMatchObject({ code: 'INVALID_GAME_INPUT' });
      expect(await f.service.get(before.game.id)).toEqual(before);
    },
  );

  it('serializes competing moves across service instances', async () => {
    const { game } = await f.active();
    const other = new GamesService(
      new GameStoreService(f.source),
      new GameRulesService(f.engine),
    );
    const results = await Promise.allSettled([
      f.service.play(f.white, game.id, 'e2e4'),
      other.play(f.white, game.id, 'd2d4'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { code: 'WRONG_TURN' } });
    const state = await f.service.get(game.id);
    expect(state.moves).toHaveLength(1);
    expect(state.moves[0].ply).toBe(1);
    expect(state.game.turn).toBe('BLACK');
  });

  it('rolls back an engine failure and allows a later retry', async () => {
    const before = await f.active();
    const unavailable = vi
      .spyOn(f.engine, 'move')
      .mockRejectedValueOnce(new Error('Connection failed'));
    await expect(
      f.service.play(f.white, before.game.id, 'e2e4'),
    ).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' });
    expect(await f.service.get(before.game.id)).toEqual(before);
    unavailable.mockRestore();
    expect(
      (await f.service.play(f.white, before.game.id, 'e2e4')).moves,
    ).toHaveLength(1);
  });

  it('rolls back the inserted move if saving the board fails', async () => {
    const before = await f.active();
    await f.source
      .query(`CREATE FUNCTION fail_board_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected board failure'; END $$`);
    await f.source.query(`CREATE TRIGGER fail_board BEFORE UPDATE ON games
      FOR EACH ROW EXECUTE FUNCTION fail_board_update()`);
    try {
      await expect(
        f.service.play(f.white, before.game.id, 'e2e4'),
      ).rejects.toThrow('injected board failure');
      expect(await f.service.get(before.game.id)).toEqual(before);
    } finally {
      await f.source.query('DROP TRIGGER fail_board ON games');
      await f.source.query('DROP FUNCTION fail_board_update()');
    }
  });

  it('rejects a gap in stored history', async () => {
    const { game } = await f.active();
    await f.service.play(f.white, game.id, 'e2e4');
    await f.source.query('UPDATE moves SET ply = 2 WHERE "gameId" = $1', [
      game.id,
    ]);
    const before = await f.service.get(game.id);
    await expect(
      f.service.play(f.black, game.id, 'e7e5'),
    ).rejects.toMatchObject({ code: 'INVALID_GAME_HISTORY' });
    expect(await f.service.get(game.id)).toEqual(before);
  });

  it('rejects a board that disagrees with its history', async () => {
    const { game } = await f.active();
    await f.source.query('UPDATE games SET "currentFen" = $1 WHERE id = $2', [
      AFTER_E4,
      game.id,
    ]);
    const before = await f.service.get(game.id);
    await expect(
      f.service.play(f.white, game.id, 'e2e4'),
    ).rejects.toMatchObject({ code: 'INVALID_GAME_HISTORY' });
    expect(await f.service.get(game.id)).toEqual(before);
  });

  it('records Black checkmate and rejects all subsequent mutations', async () => {
    const { game } = await f.active();
    const state = await f.playLine(game.id, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect(state.game).toMatchObject({
      status: 'FINISHED',
      result: 'BLACK_WIN',
    });
    expect(state.game.finishedAt).toBeInstanceOf(Date);
    expect(state.game.finishedAt!.getTime()).toBeGreaterThanOrEqual(
      state.game.startedAt!.getTime(),
    );
    await expect(
      f.service.play(f.white, game.id, 'e2e4'),
    ).rejects.toMatchObject({ code: 'GAME_ALREADY_FINISHED' });
    await expect(f.service.join(f.outsider, game.id)).rejects.toMatchObject({
      code: 'GAME_ALREADY_FINISHED',
    });
    expect(await f.service.get(game.id)).toEqual(state);
  });

  it.each([
    { fen: '7k/8/5KQ1/8/8/8/8/8 w - - 0 1', uci: 'g6g7', result: 'WHITE_WIN' },
    { fen: '7k/5K2/8/6Q1/8/8/8/8 w - - 0 1', uci: 'g5g6', result: 'DRAW' },
    { fen: '7k/8/8/8/8/8/1b6/K1N5 w - - 0 1', uci: 'a1b2', result: 'DRAW' },
  ])('persists terminal engine outcomes: %j', async ({ fen, uci, result }) => {
    const { game } = await f.active(fen);
    const state = await f.service.play(f.white, game.id, uci);
    expect(state.game).toMatchObject({ status: 'FINISHED', result });
    expect(state.moves).toHaveLength(1);
    expect(await f.service.get(game.id)).toEqual(state);
  });
});
