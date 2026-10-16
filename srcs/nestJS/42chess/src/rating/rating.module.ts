import { Module } from '@nestjs/common';
import { RatingService } from './rating.service.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity.js';
import { RatingHistory } from './rating-history.entity.js';

/**
 * ELO computation and rating history. Ratings are only updated by the
 * backend when a game ends; clients can never change them directly.
 *
 * Routes: `/users/:id/rating-history` (see spec §25–§26).
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, RatingHistory])],
  providers: [RatingService],
  exports: [RatingService],
})
export class RatingModule {}
