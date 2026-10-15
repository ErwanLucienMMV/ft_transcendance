import { ChessEngineService } from '../dist/chess/chess-engine.service.js';
import { assertFen } from '../dist/chess/fen.js';
import { algebraicMove } from '../dist/games/game-notation.js';
import { puzzleFixtures } from '../dist/database/seeds/puzzle-fixtures.js';
import { validatePuzzle } from '../dist/puzzles/puzzle-validation.js';
import type { Square } from '../dist/common/types/chess.js';
import type { Puzzle } from '../dist/puzzles/puzzle.types.js';

const ids = {
  whitePuzzle: 'd0000000-0000-4000-8000-000000000005',
  blackPuzzle: 'd0000000-0000-4000-8000-000000000006',
  alice: 'd0000000-0000-4000-8000-000000000001',
  bob: 'd0000000-0000-4000-8000-000000000002',
};
describe('FEN puzzle references and actual chess legality', () => {
  const engine = new ChessEngineService();
  beforeAll(() => {
    process.env.CHESS_ENGINE_URL =
      process.env.TEST_CHESS_ENGINE_URL ?? 'ws://127.0.0.1:55433';
  });
  it('replays the documented Lichess 00sHx sample after its setup move', async () => {
    // Source: https://database.lichess.org/#puzzles (CC0). Not added to runtime dependencies.
    const fen = 'q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17';
    assertFen(fen);
    const beforeSetup = await engine.analyze({ fen });
    expect(beforeSetup.legalMoves).toContain('e8d7');
    const start = await engine.analyze({ fen, moves: ['e8d7'] });
    assertFen(start.fen);
    expect(start.turn).toBe('white');
    // Move authors and time below are explicitly synthetic test annotations.
    const reference: Puzzle = {
      id: ids.whitePuzzle,
      fen: start.fen,
      rating: 1760,
      themes: ['MATE_IN_TWO'],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      solution: [],
    };
    let before = start;
    const moves: string[] = [];
    for (const uci of ['a2e6', 'd7d8', 'f7f8']) {
      expect(before.legalMoves).toContain(uci);
      moves.push(uci);
      const after = await engine.analyze({ fen: start.fen, moves });
      assertFen(after.fen);
      reference.solution.push({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        notation: algebraicMove(before, after, uci),
        timestamp: reference.createdAt,
        playerId: before.turn === 'white' ? ids.alice : ids.bob,
      });
      before = after;
    }
    expect(before.checkmate).toBe(true);
    await validatePuzzle(reference, engine);
  });
  it('rejects legal-looking UCI with wrong SAN or illegal engine moves', async () => {
    const original = puzzleFixtures(ids)[0];
    await expect(validatePuzzle(original, engine)).resolves.toBeUndefined();
    await expect(
      validatePuzzle(
        {
          ...original,
          solution: [{ ...original.solution[0], notation: 'Qg7' }],
        },
        engine,
      ),
    ).rejects.toThrow(/SAN/);
    await expect(
      validatePuzzle(
        { ...original, solution: [{ ...original.solution[0], to: 'e5' }] },
        engine,
      ),
    ).rejects.toThrow(/illegal/);
    await expect(
      validatePuzzle(
        {
          ...original,
          solution: [
            { ...original.solution[0], timestamp: new Date('invalid') },
          ],
        },
        engine,
      ),
    ).rejects.toThrow(/metadata/);
  });
});
