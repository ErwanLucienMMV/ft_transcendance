import { gameFixture } from './game-service.fixture.js';

describe('Persisted algebraic move notation', () => {
  const f = gameFixture();
  it('records ordinary moves, pawn captures and checkmate from real engine outcomes', async () => {
    const { game } = await f.active();
    const state = await f.playLine(game.id, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect(state.moves.map((move) => move.notation)).toEqual([
      'f3',
      'e5',
      'g4',
      'Qh4#',
    ]);
    const capture = await f.active();
    const captured = await f.playLine(capture.game.id, [
      'e2e4',
      'd7d5',
      'e4d5',
    ]);
    expect(captured.moves.at(-1)?.notation).toBe('exd5');
  });
  it.each([
    { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', uci: 'e1g1', san: 'O-O' },
    { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', uci: 'e1c1', san: 'O-O-O' },
    { fen: '7k/8/8/3pP3/8/8/8/K7 w - d6 0 1', uci: 'e5d6', san: 'exd6' },
    { fen: '7k/P7/8/8/8/8/8/K7 w - - 0 1', uci: 'a7a8q', san: 'a8=Q+' },
    { fen: '7k/8/8/8/8/8/8/KN3N2 w - - 0 1', uci: 'b1d2', san: 'Nbd2' },
    { fen: '7k/8/8/8/8/1N6/8/KN6 w - - 0 1', uci: 'b1d2', san: 'N1d2' },
    { fen: '7k/8/8/1N6/8/1N3N2/8/K7 w - - 0 1', uci: 'b3d4', san: 'Nb3d4' },
    // A pinned knight cannot disambiguate another knight's legal move.
    { fen: 'k3r3/8/8/8/8/2N1N3/8/4K3 w - - 0 1', uci: 'c3d5', san: 'Nd5' },
  ])('stores SAN rather than UCI for %j', async ({ fen, uci, san }) => {
    const { game } = await f.active(fen);
    const state = await f.service.play(f.white, game.id, uci);
    expect(state.moves[0].notation).toBe(san);
    expect((await f.service.get(game.id)).moves[0].notation).toBe(san);
  });
});
