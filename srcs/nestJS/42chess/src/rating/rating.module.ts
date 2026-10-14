import { Module } from '@nestjs/common';

/**
 * ELO computation and rating history. Ratings are only updated by the
 * backend when a game ends; clients can never change them directly.
 *
 * Routes: `/users/:id/rating-history` (see spec §25–§26).
 */
@Module({})
export class RatingModule {}
