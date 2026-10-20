import { readFileSync } from 'node:fs';
import { calculateGameRatings } from './elo-calculation.js';
import { INITIAL_ELO, ELO_K_FACTOR } from './rating.constants.js';

describe('SCRUM-515 documented ELO rules', () => {
  const documentation = readFileSync(
    new URL('../../ELO.md', import.meta.url),
    'utf8',
  );
  it('states the implemented initial rating and K-factor', () => {
    expect(documentation).toContain(
      `Each account starts at **${INITIAL_ELO}**`,
    );
    expect(documentation).toContain(
      `The K-factor is fixed at **${ELO_K_FACTOR}**`,
    );
  });
  it('keeps all five published examples consistent with the implementation', () => {
    const examples = [
      ...documentation.matchAll(
        /^\|\s*(\d+) vs (\d+)\s*\|\s*(First player wins|Draw)\s*\|\s*([+-]?\d+) \/ ([+-]?\d+)\s*\|\s*(\d+) \/ (\d+)\s*\|/gm,
      ),
    ];
    expect(examples).toHaveLength(5);
    for (const [
      ,
      ratingA,
      ratingB,
      result,
      deltaA,
      deltaB,
      afterA,
      afterB,
    ] of examples) {
      const ratings = calculateGameRatings({
        ratingA: Number(ratingA),
        ratingB: Number(ratingB),
        scoreA: result === 'Draw' ? 0.5 : 1,
      });
      expect(ratings.a).toEqual({
        ratingBefore: Number(ratingA),
        ratingAfter: Number(afterA),
        change: Number(deltaA),
      });
      expect(ratings.b).toEqual({
        ratingBefore: Number(ratingB),
        ratingAfter: Number(afterB),
        change: Number(deltaB),
      });
    }
  });
});
