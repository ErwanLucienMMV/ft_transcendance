import { Module } from '@nestjs/common';
import { RatingService } from './rating.service.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity.js';
import { RatingHistory } from './rating-history.entity.js';
import { RatingHistoryService } from './rating-history.service.js';
import { RatingController } from './rating.controller.js';

/**
 * ELO computation and rating history. Ratings are only updated by the
 * backend when a game ends; clients can never change them directly.
 *
 * Routes: `/users/:id/rating-history` (see spec §25–§26).
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, RatingHistory])],
  providers: [RatingService, RatingHistoryService],
  controllers: [RatingController],
  exports: [RatingService],
})
export class RatingModule {}
