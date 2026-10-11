import { vi } from 'vitest';
import { gameFixture, INITIAL_FEN } from './game-service.fixture.js';

describe('Game rules engine boundary failures', () => {
  const f = gameFixture();
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { fen: 'broken' },
    { turn: 'green' },
    { status: 'unexpected' },
    { checkmate: true },
    { winner: 'white' },
    { repetitionCount: 0 },
    { threefoldClaimable: 'yes' },
    { fiftyMoveClaimable: null },
    { legalMoves: ['broken'] },
  ])(
    'rejects a malformed snapshot without storing a move: %j',
    async (change) => {
      const before = await f.active();
      const snapshot = await f.engine.move('e2e4', { fen: INITIAL_FEN });
      vi.spyOn(f.engine, 'move').mockResolvedValueOnce({
        ...snapshot,
        ...change,
      } as never);
      await expect(
        f.service.play(f.white, before.game.id, 'e2e4'),
      ).rejects.toMatchObject({ code: 'INVALID_ENGINE_RESPONSE' });
      expect(await f.service.get(before.game.id)).toEqual(before);
    },
  );

  it.each([null, undefined, { legal: 'true', fen: INITIAL_FEN }])(
    'rejects malformed move validation: %j',
    async (response) => {
      const before = await f.active();
      vi.spyOn(f.engine, 'validate').mockResolvedValueOnce(response as never);
      await expect(
        f.service.play(f.white, before.game.id, 'e2e4'),
      ).rejects.toMatchObject({ code: 'INVALID_ENGINE_RESPONSE' });
      expect(await f.service.get(before.game.id)).toEqual(before);
    },
  );

  it('rejects a valid-shaped move response that did not switch the turn', async () => {
    const before = await f.active();
    const snapshot = await f.engine.analyze({ fen: INITIAL_FEN });
    vi.spyOn(f.engine, 'move').mockResolvedValueOnce(snapshot);
    await expect(
      f.service.play(f.white, before.game.id, 'e2e4'),
    ).rejects.toMatchObject({ code: 'INVALID_ENGINE_RESPONSE' });
    expect(await f.service.get(before.game.id)).toEqual(before);
  });

  it('does not create anything if initial analysis is unavailable', async () => {
    vi.spyOn(f.engine, 'analyze').mockRejectedValueOnce(
      new Error('Engine down'),
    );
    await expect(
      f.service.create(f.white, { initialTime: 60000 }),
    ).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' });
    expect(await f.count('games')).toBe(0);
    expect(await f.count('game_players')).toBe(0);
  });

  it('rejects malformed initial analysis instead of accepting a partial response', async () => {
    vi.spyOn(f.engine, 'analyze').mockResolvedValueOnce({
      status: 'ongoing',
    } as never);
    await expect(
      f.service.create(f.white, { initialTime: 60000 }),
    ).rejects.toMatchObject({ code: 'INVALID_ENGINE_RESPONSE' });
    expect(await f.count('games')).toBe(0);
  });

  it('rejects an analysis inconsistent with the stored board during a draw claim', async () => {
    const before = await f.active('7k/8/8/8/8/8/R7/K7 w - - 100 51');
    const snapshot = await f.engine.analyze({ fen: INITIAL_FEN });
    vi.spyOn(f.engine, 'analyze').mockResolvedValueOnce(snapshot);
    await expect(
      f.service.claimDraw(f.white, before.game.id, 'FIFTY_MOVE'),
    ).rejects.toMatchObject({ code: 'INVALID_GAME_HISTORY' });
    expect(await f.service.get(before.game.id)).toEqual(before);
  });

  it.each([
    { reason: 'THREEFOLD_REPETITION', change: { threefoldClaimable: true } },
    { reason: 'FIFTY_MOVE', change: { fiftyMoveClaimable: true } },
  ] as const)(
    'rejects contradictory draw flags: $reason',
    async ({ reason, change }) => {
      const before = await f.active();
      const snapshot = await f.engine.analyze({ fen: INITIAL_FEN });
      vi.spyOn(f.engine, 'analyze').mockResolvedValueOnce({
        ...snapshot,
        ...change,
      });
      await expect(
        f.service.claimDraw(f.white, before.game.id, reason),
      ).rejects.toMatchObject({ code: 'INVALID_ENGINE_RESPONSE' });
      expect(await f.service.get(before.game.id)).toEqual(before);
    },
  );

  it('rejects checkmate responses that still contain legal moves', async () => {
    const before = await f.active('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
    const snapshot = await f.engine.move('g6g7', {
      fen: before.game.initialFen,
    });
    vi.spyOn(f.engine, 'move').mockResolvedValueOnce({
      ...snapshot,
      legalMoves: ['h8h7'],
    });
    await expect(
      f.service.play(f.white, before.game.id, 'g6g7'),
    ).rejects.toMatchObject({ code: 'INVALID_ENGINE_RESPONSE' });
    expect(await f.service.get(before.game.id)).toEqual(before);
  });
});
