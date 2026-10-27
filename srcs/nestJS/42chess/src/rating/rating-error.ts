export type RatingErrorCode =
  | 'RATING_TRANSACTION_REQUIRED'
  | 'INVALID_RATING_GAME'
  | 'INVALID_RATING_PARTICIPANTS'
  | 'INCONSISTENT_RATING_HISTORY';

/** Internal integrity failures; never expose account details in HTTP errors. */
export class RatingError extends Error {
  constructor(
    readonly code: RatingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RatingError';
  }
}
