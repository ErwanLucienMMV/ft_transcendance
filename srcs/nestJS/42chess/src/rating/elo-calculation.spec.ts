import {
  calculateGameRatings,
  calculateRatingChange,
  calculateRatingDelta,
  expectedScore,
} from './elo-calculation.js';
import type { EloGameInput, EloScore } from './elo-calculation.js';
import {
  ELO_K_FACTOR,
  INITIAL_ELO,
  MAX_ELO,
  MIN_ELO,
} from './rating.constants.js';

describe('ELO calculation (SCRUM-205–210, SCRUM-215)', () => {
  const invalidRatings: unknown[] = [
    -1,
    1200.5,
    NaN,
    Infinity,
    -Infinity,
    MAX_ELO + 1,
    Number.MAX_SAFE_INTEGER,
    '1200',
    null,
    undefined,
    true,
    {},
    [],
  ];

  it('uses the specified initial rating and approved fixed policy', () => {
    expect(INITIAL_ELO).toBe(1200);
    expect(ELO_K_FACTOR).toBe(32);
    expect(MIN_ELO).toBe(0);
    expect(MAX_ELO).toBe(2_147_483_647);
  });

  describe('expected score', () => {
    it.each([0, INITIAL_ELO, MAX_ELO])(
      'gives equal ratings of %s equal chances',
      (rating) => {
        expect(expectedScore(rating, rating)).toBe(0.5);
      },
    );

    it('gives a 400-point favorite ten times the opponent odds', () => {
      expect(expectedScore(1600, 1200)).toBeCloseTo(10 / 11, 14);
      expect(expectedScore(1200, 1600)).toBeCloseTo(1 / 11, 14);
    });

    it.each([1, 200, 400, 1000, 10_000, MAX_ELO])(
      'keeps opposite expectations complementary for a %s-point gap',
      (gap) => {
        expect(expectedScore(gap, 0) + expectedScore(0, gap)).toBeCloseTo(
          1,
          14,
        );
      },
    );

    it('handles the largest valid gap without NaN or infinite scores', () => {
      expect(expectedScore(0, MAX_ELO)).toBe(0);
      expect(expectedScore(MAX_ELO, 0)).toBe(1);
    });

    it.each(invalidRatings)(
      'rejects invalid rating %j on either side',
      (bad) => {
        expect(() => expectedScore(bad as number, 1200)).toThrow(RangeError);
        expect(() => expectedScore(1200, bad as number)).toThrow(RangeError);
        expect(() => calculateRatingChange(bad as number, 1200, 1)).toThrow(
          RangeError,
        );
        expect(() => calculateRatingChange(1200, bad as number, 1)).toThrow(
          RangeError,
        );
        expect(() =>
          calculateGameRatings({
            ratingA: bad as number,
            ratingB: 1200,
            scoreA: 1,
          }),
        ).toThrow(RangeError);
        expect(() =>
          calculateGameRatings({
            ratingA: 1200,
            ratingB: bad as number,
            scoreA: 1,
          }),
        ).toThrow(RangeError);
      },
    );
  });

  describe('rating deltas and rounding', () => {
    it.each([
      [0.5, 1, 16],
      [0.5, 0, -16],
      [0.5, 0.5, 0],
      [0, 1, 32],
      [1, 0, -32],
      [0, 0, 0],
      [1, 1, 0],
      [0, 0.5, 16],
      [1, 0.5, -16],
      [63 / 64, 1, 1],
      [1 / 64, 0, -1],
      [1 / 64, 1, 32],
      [63 / 64, 0, -32],
      [0.25, 0.5, 8],
      [0.75, 0.5, -8],
    ] as const)(
      'rounds expected %s with score %s to %s',
      (expected, score, change) => {
        expect(calculateRatingDelta(expected, score)).toBe(change);
      },
    );

    it('rounds just below and above half points in both directions', () => {
      const below = 0.5 - 1e-10;
      const above = 0.5 + 1e-10;
      expect(calculateRatingDelta(1 - below / 32, 1)).toBe(0);
      expect(calculateRatingDelta(1 - above / 32, 1)).toBe(1);
      expect(calculateRatingDelta(below / 32, 0)).toBe(0);
      expect(calculateRatingDelta(above / 32, 0)).toBe(-1);
    });

    it('returns positive zero for small negative changes and exact zero', () => {
      expect(Object.is(calculateRatingDelta(0.001, 0), -0)).toBe(false);
      expect(Object.is(calculateRatingDelta(0.5, 0.5), -0)).toBe(false);
      expect(calculateRatingChange(2000, 1000, 1).change).toBe(0);
    });

    it.each([
      -0.01,
      1.01,
      NaN,
      Infinity,
      -Infinity,
      '0.5',
      null,
      undefined,
      false,
      {},
      [],
    ])('rejects invalid expected score %j', (bad) => {
      expect(() => calculateRatingDelta(bad as number, 1)).toThrow(RangeError);
    });

    it.each([-1, 0.25, 0.75, 2, NaN, Infinity, '1', null, undefined, true, {}])(
      'rejects invalid actual score %j at every entry point',
      (bad) => {
        expect(() => calculateRatingDelta(0.5, bad as EloScore)).toThrow(
          RangeError,
        );
        expect(() =>
          calculateRatingChange(1200, 1200, bad as EloScore),
        ).toThrow(RangeError);
        expect(() =>
          calculateGameRatings({
            ratingA: 1200,
            ratingB: 1200,
            scoreA: bad as EloScore,
          }),
        ).toThrow(RangeError);
      },
    );
  });

  describe('victory, defeat, draw, and floor', () => {
    it.each([
      [1200, 1200, 1, 1216, 16],
      [1200, 1200, 0, 1184, -16],
      [1200, 1200, 0.5, 1200, 0],
      [1600, 1200, 1, 1603, 3],
      [1200, 1600, 0, 1197, -3],
      [1200, 1600, 1, 1229, 29],
      [1600, 1200, 0, 1571, -29],
      [1600, 1200, 0.5, 1587, -13],
      [1200, 1600, 0.5, 1213, 13],
      [2000, 1000, 1, 2000, 0],
      [1000, 2000, 0, 1000, 0],
      [0, 0, 0, 0, 0],
      [1, 1, 0, 0, -1],
      [15, 15, 0, 0, -15],
      [16, 16, 0, 0, -16],
      [17, 17, 0, 1, -16],
      [0, 0, 0.5, 0, 0],
      [0, MAX_ELO, 1, 32, 32],
      [MAX_ELO, 0, 0, MAX_ELO - 32, -32],
      [MAX_ELO, 0, 1, MAX_ELO, 0],
      [MAX_ELO, MAX_ELO, 0.5, MAX_ELO, 0],
      [MAX_ELO - 16, MAX_ELO - 16, 1, MAX_ELO, 16],
    ] as const)(
      '%s against %s scoring %s yields rating %s and change %s',
      (ratingBefore, opponent, score, ratingAfter, change) => {
        expect(calculateRatingChange(ratingBefore, opponent, score)).toEqual({
          ratingBefore,
          ratingAfter,
          change,
        });
      },
    );

    it.each([MAX_ELO, MAX_ELO - 15])(
      'rejects a winning result above the integer maximum from %s',
      (rating) => {
        expect(() => calculateRatingChange(rating, rating, 1)).toThrow(
          RangeError,
        );
      },
    );
  });

  describe('two-player calculation', () => {
    it('calculates both changes from the original ratings', () => {
      expect(
        calculateGameRatings({ ratingA: 1400, ratingB: 1200, scoreA: 1 }),
      ).toEqual({
        a: { ratingBefore: 1400, ratingAfter: 1408, change: 8 },
        b: { ratingBefore: 1200, ratingAfter: 1192, change: -8 },
      });
    });

    it('preserves the floor-adjusted change even when changes are not zero-sum', () => {
      expect(
        calculateGameRatings({ ratingA: 0, ratingB: 0, scoreA: 1 }),
      ).toEqual({
        a: { ratingBefore: 0, ratingAfter: 16, change: 16 },
        b: { ratingBefore: 0, ratingAfter: 0, change: 0 },
      });
    });

    it.each([0, 0.5, 1] as const)(
      'is deterministic and does not mutate the input for score %s',
      (scoreA) => {
        const input = Object.freeze({ ratingA: 1600, ratingB: 1200, scoreA });
        const result = calculateGameRatings(input);
        expect(calculateGameRatings(input)).toEqual(result);
        expect(input).toEqual({ ratingA: 1600, ratingB: 1200, scoreA });
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.a)).toBe(true);
        expect(Object.isFrozen(result.b)).toBe(true);
        expect(result.a.change + result.b.change).toBe(0);
      },
    );

    it('does not retain mutable input objects or share result objects', () => {
      const input: EloGameInput = { ratingA: 1200, ratingB: 1200, scoreA: 1 };
      const result = calculateGameRatings(input);
      const repeated = calculateGameRatings(input);
      expect(result).not.toBe(repeated);
      expect(result.a).not.toBe(repeated.a);
      expect(result.a).not.toBe(result.b);
    });

    it('rejects overflow for either player without changing the input snapshot', () => {
      for (const scoreA of [0, 1] as const) {
        const input = Object.freeze({
          ratingA: MAX_ELO,
          ratingB: MAX_ELO,
          scoreA,
        });
        expect(() => calculateGameRatings(input)).toThrow(RangeError);
        expect(input).toEqual({ ratingA: MAX_ELO, ratingB: MAX_ELO, scoreA });
      }
    });

    it.each([null, undefined, true, 1200, 'game', {}, []])(
      'rejects missing or malformed game snapshot %j',
      (bad) => {
        expect(() => calculateGameRatings(bad as EloGameInput)).toThrow(
          RangeError,
        );
      },
    );

    it('keeps ratings valid, bounded, and symmetric across a range of matchups', () => {
      const ratings = [0, 1, 16, 719, 720, 1200, 1600, 2500, 10_000];
      for (const ratingA of ratings) {
        for (const ratingB of ratings) {
          for (const scoreA of [0, 0.5, 1] as const) {
            const result = calculateGameRatings({ ratingA, ratingB, scoreA });
            const swapped = calculateGameRatings({
              ratingA: ratingB,
              ratingB: ratingA,
              scoreA: (1 - scoreA) as EloScore,
            });
            expect(result).toEqual({ a: swapped.b, b: swapped.a });
            for (const adjustment of [result.a, result.b]) {
              expect(Number.isInteger(adjustment.ratingAfter)).toBe(true);
              expect(adjustment.ratingAfter).toBeGreaterThanOrEqual(0);
              expect(Math.abs(adjustment.change)).toBeLessThanOrEqual(32);
              expect(adjustment.change).toBe(
                adjustment.ratingAfter - adjustment.ratingBefore,
              );
              expect(Object.is(adjustment.change, -0)).toBe(false);
            }
          }
        }
      }
    });
  });
});
