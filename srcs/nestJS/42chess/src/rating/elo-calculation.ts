import { ELO_K_FACTOR, MAX_ELO, MIN_ELO } from './rating.constants.js';

/** Actual score from Proposition spec.md §26: defeat, draw, victory. */
export type EloScore = 0 | 0.5 | 1;

/** Calculation fields of RatingChange (§26); persistence supplies its metadata. */
export interface RatingAdjustment {
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly change: number;
}

export interface EloGameInput {
  readonly ratingA: number;
  readonly ratingB: number;
  readonly scoreA: EloScore;
}

export interface EloGameRatings {
  readonly a: RatingAdjustment;
  readonly b: RatingAdjustment;
}

/** SCRUM-206: standard expected score; extreme differences saturate at 0 or 1. */
export function expectedScore(rating: number, opponentRating: number): number {
  validateRating(rating);
  validateRating(opponentRating);
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/** SCRUM-207–210: round to nearest, with exact halves away from zero. */
export function calculateRatingDelta(
  expected: number,
  actualScore: EloScore,
): number {
  if (!Number.isFinite(expected) || expected < 0 || expected > 1) {
    throw new RangeError('Expected score must be a finite number from 0 to 1.');
  }
  if (actualScore !== 0 && actualScore !== 0.5 && actualScore !== 1) {
    throw new RangeError('Actual score must be 0, 0.5, or 1.');
  }
  const rawChange = ELO_K_FACTOR * (actualScore - expected);
  const magnitude = Math.round(Math.abs(rawChange));
  // A small negative loss must serialize as 0, never negative zero.
  return magnitude === 0 ? 0 : Math.sign(rawChange) * magnitude;
}

/** Returns the applied change after the floor, using pre-game ratings only. */
export function calculateRatingChange(
  ratingBefore: number,
  opponentRating: number,
  actualScore: EloScore,
): RatingAdjustment {
  const change = calculateRatingDelta(
    expectedScore(ratingBefore, opponentRating),
    actualScore,
  );
  const ratingAfter = Math.max(MIN_ELO, ratingBefore + change);
  if (ratingAfter > MAX_ELO) {
    throw new RangeError(
      'Resulting rating exceeds the PostgreSQL integer range.',
    );
  }
  return Object.freeze({
    ratingBefore,
    ratingAfter,
    change: ratingAfter - ratingBefore,
  });
}

/** Both calculations use the same input snapshot; neither uses an updated rating. */
export function calculateGameRatings(input: EloGameInput): EloGameRatings {
  if (input === null || typeof input !== 'object') {
    throw new RangeError('A game rating snapshot is required.');
  }
  const { ratingA, ratingB, scoreA } = input;
  const a = calculateRatingChange(ratingA, ratingB, scoreA);
  const b = calculateRatingChange(ratingB, ratingA, (1 - scoreA) as EloScore);
  return Object.freeze({ a, b });
}

function validateRating(rating: number): void {
  if (!Number.isInteger(rating) || rating < MIN_ELO || rating > MAX_ELO) {
    throw new RangeError(
      `Rating must be an integer from ${MIN_ELO} to ${MAX_ELO}.`,
    );
  }
}
