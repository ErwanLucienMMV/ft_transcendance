import type { Puzzle } from '../../puzzles/puzzle.types.js';

/** Composed test positions, not imported historical games. Move authors/time are fixture metadata. */
export function puzzleFixtures(ids: {
  whitePuzzle: string;
  blackPuzzle: string;
  alice: string;
  bob: string;
}): Puzzle[] {
  const createdAt = new Date('2026-01-01T00:00:00Z');
  return [
    {
      id: ids.whitePuzzle,
      fen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
      rating: 800,
      themes: ['CHECKMATE', 'MATE_IN_ONE'],
      createdAt,
      solution: [
        {
          from: 'f7',
          to: 'g7',
          notation: 'Qg7#',
          timestamp: createdAt,
          playerId: ids.alice,
        },
      ],
    },
    {
      id: ids.blackPuzzle,
      fen: '8/8/8/8/8/6k1/5q2/7K b - - 0 1',
      rating: 800,
      themes: ['CHECKMATE', 'MATE_IN_ONE'],
      createdAt,
      solution: [
        {
          from: 'f2',
          to: 'g2',
          notation: 'Qg2#',
          timestamp: createdAt,
          playerId: ids.bob,
        },
      ],
    },
  ];
}
