import type { UUID, ISODateString } from '../common/types/api.js';
import type { RatingHistory } from './rating-history.entity.js';

export interface RatingChange {
  id: UUID;
  userId: UUID;
  gameId: UUID;
  ratingBefore: number;
  ratingAfter: number;
  change: number;
  createdAt: Date;
}
export type RatingHistoryResponse = {
  history: Array<
    Omit<RatingChange, 'id' | 'userId' | 'createdAt'> & {
      createdAt: ISODateString;
    }
  >;
};
export function toRatingChange(row: RatingHistory): RatingChange {
  return {
    id: row.id,
    userId: row.userId,
    gameId: row.gameId,
    ratingBefore: row.ratingBefore,
    ratingAfter: row.ratingAfter,
    change: row.change,
    createdAt: row.createdAt,
  };
}
export function toRatingHistoryResponse(
  rows: RatingHistory[],
): RatingHistoryResponse {
  return {
    history: rows.map((row) => ({
      gameId: row.gameId,
      ratingBefore: row.ratingBefore,
      ratingAfter: row.ratingAfter,
      change: row.change,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
