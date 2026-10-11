import { gameFixture } from './game-service.fixture.js';

const CYCLE = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
const FIFTY_FEN = '7k/8/8/8/8/8/R7/K7 w - - 100 51';

describe('Server-verified draw claims', () => {
  const f = gameFixture();

  it('keeps threefold claimable games active until the player claims', async () => {
    const { game } = await f.active();
    const before = await f.playLine(game.id, [...CYCLE, ...CYCLE]);
    expect(before.game.status).toBe('ACTIVE');
    const state = await f.service.claimDraw(
      f.white,
      game.id,
      'THREEFOLD_REPETITION',
    );
    expect(state.game).toMatchObject({ status: 'FINISHED', result: 'DRAW' });
    expect(state.game.finishedAt).toBeInstanceOf(Date);
    expect(state.moves).toEqual(before.moves);
    expect(state.game.currentFen).toBe(before.game.currentFen);
  });

  it('claims a repetition from a legal intended move without persisting that move', async () => {
    const { game } = await f.active();
    const before = await f.playLine(game.id, [
      ...CYCLE,
      'g1f3',
      'g8f6',
      'f3g1',
    ]);
    const state = await f.service.claimDraw(
      f.black,
      game.id,
      'THREEFOLD_REPETITION',
      'f6g8',
    );
    expect(state.game).toMatchObject({
      status: 'FINISHED',
      result: 'DRAW',
      currentFen: before.game.currentFen,
    });
    expect(state.moves).toEqual(before.moves);
    expect(state.moves).toHaveLength(7);
  });

  it('rejects a repetition claim with only two occurrences', async () => {
    const { game } = await f.active();
    const before = await f.playLine(game.id, CYCLE);
    await expect(
      f.service.claimDraw(f.white, game.id, 'THREEFOLD_REPETITION'),
    ).rejects.toMatchObject({ code: 'DRAW_NOT_CLAIMABLE' });
    expect(await f.service.get(game.id)).toEqual(before);
  });

  it('claims fifty moves from the current halfmove clock', async () => {
    const { game } = await f.active(FIFTY_FEN);
    const state = await f.service.claimDraw(f.white, game.id, 'FIFTY_MOVE');
    expect(state.game).toMatchObject({
      status: 'FINISHED',
      result: 'DRAW',
      currentFen: FIFTY_FEN,
    });
    expect(state.moves).toEqual([]);
  });

  it('claims fifty moves with a legal intended move without writing it', async () => {
    const fen = '7k/8/8/8/8/8/R7/K7 w - - 99 51';
    const { game } = await f.active(fen);
    const state = await f.service.claimDraw(
      f.white,
      game.id,
      'FIFTY_MOVE',
      'a2a3',
    );
    expect(state.game).toMatchObject({
      status: 'FINISHED',
      result: 'DRAW',
      currentFen: fen,
    });
    expect(state.moves).toEqual([]);
  });

  it('rejects premature fifty-move claims', async () => {
    const before = await f.active('7k/8/8/8/8/8/R7/K7 w - - 99 51');
    await expect(
      f.service.claimDraw(f.white, before.game.id, 'FIFTY_MOVE'),
    ).rejects.toMatchObject({ code: 'DRAW_NOT_CLAIMABLE' });
    expect(await f.service.get(before.game.id)).toEqual(before);
  });

  it('keeps a game active when a played move reaches one hundred reversible plies', async () => {
    const { game } = await f.active('7k/8/8/8/8/8/R7/K7 w - - 99 51');
    const state = await f.service.play(f.white, game.id, 'a2a3');
    expect(state.game.status).toBe('ACTIVE');
    expect(state.game.result).toBeNull();
    expect(
      (await f.service.claimDraw(f.black, game.id, 'FIFTY_MOVE')).game.result,
    ).toBe('DRAW');
  });

  it('rejects an illegal intended move before evaluating a claim', async () => {
    const before = await f.active(FIFTY_FEN);
    await expect(
      f.service.claimDraw(f.white, before.game.id, 'FIFTY_MOVE', 'a2b3'),
    ).rejects.toMatchObject({ code: 'ILLEGAL_MOVE' });
    expect(await f.service.get(before.game.id)).toEqual(before);
  });

  it('requires membership and the claimant turn', async () => {
    const before = await f.active(FIFTY_FEN);
    await expect(
      f.service.claimDraw(f.outsider, before.game.id, 'FIFTY_MOVE'),
    ).rejects.toMatchObject({ code: 'NOT_A_PLAYER' });
    await expect(
      f.service.claimDraw(f.black, before.game.id, 'FIFTY_MOVE'),
    ).rejects.toMatchObject({ code: 'WRONG_TURN' });
    expect(await f.service.get(before.game.id)).toEqual(before);
  });

  it('cannot replace the result or play after a successful claim', async () => {
    const { game } = await f.active(FIFTY_FEN);
    const before = await f.service.claimDraw(f.white, game.id, 'FIFTY_MOVE');
    await expect(
      f.service.claimDraw(f.white, game.id, 'FIFTY_MOVE'),
    ).rejects.toMatchObject({ code: 'GAME_ALREADY_FINISHED' });
    await expect(
      f.service.play(f.white, game.id, 'a2a3'),
    ).rejects.toMatchObject({ code: 'GAME_ALREADY_FINISHED' });
    expect(await f.service.get(game.id)).toEqual(before);
  });

  it('serializes a claim competing with a move', async () => {
    const { game } = await f.active(FIFTY_FEN);
    const results = await Promise.allSettled([
      f.service.claimDraw(f.white, game.id, 'FIFTY_MOVE'),
      f.service.play(f.white, game.id, 'a2a3'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const state = await f.service.get(game.id);
    if (state.game.status === 'FINISHED') {
      expect(state.game.result).toBe('DRAW');
      expect(state.moves).toHaveLength(0);
    } else {
      expect(state.moves).toHaveLength(1);
      expect(state.game.turn).toBe('BLACK');
    }
  });

  it.each(['AGREEMENT', null, ''])(
    'rejects unsupported claim reasons: %s',
    async (reason) => {
      const before = await f.active(FIFTY_FEN);
      await expect(
        f.service.claimDraw(f.white, before.game.id, reason as never),
      ).rejects.toMatchObject({ code: 'INVALID_GAME_INPUT' });
      expect(await f.service.get(before.game.id)).toEqual(before);
    },
  );

  it('can claim a current repetition at the engine history limit', async () => {
    const { game } = await f.active();
    const boards = [
      'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq -',
      'rnbqkb1r/pppppppp/5n2/8/8/5N2/PPPPPPPP/RNBQKB1R w KQkq -',
      'rnbqkb1r/pppppppp/5n2/8/8/8/PPPPPPPP/RNBQKBNR b KQkq -',
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
    ];
    const moves = Array.from({ length: 2048 }, (_, index) => ({
      ply: index + 1,
      color: index % 2 === 0 ? 'WHITE' : 'BLACK',
      uci: CYCLE[index % 4],
      fenAfter: `${boards[index % 4]} ${index + 1} ${Math.floor((index + 1) / 2) + 1}`,
    }));
    await f.source.query(
      `INSERT INTO moves ("gameId", ply, color, uci, "fenAfter")
      SELECT $1, ply, color, uci, "fenAfter" FROM jsonb_to_recordset($2::jsonb)
      AS m(ply integer, color varchar, uci varchar, "fenAfter" text)`,
      [game.id, JSON.stringify(moves)],
    );
    await f.source.query('UPDATE games SET "currentFen" = $1 WHERE id = $2', [
      moves[2047].fenAfter,
      game.id,
    ]);
    await expect(
      f.service.play(f.white, game.id, 'g1f3'),
    ).rejects.toMatchObject({ code: 'INVALID_GAME_INPUT' });
    const state = await f.service.claimDraw(
      f.white,
      game.id,
      'THREEFOLD_REPETITION',
    );
    expect(state.game).toMatchObject({ status: 'FINISHED', result: 'DRAW' });
    expect(state.moves).toHaveLength(2048);
  });
});
