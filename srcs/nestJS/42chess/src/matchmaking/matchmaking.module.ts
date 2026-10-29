import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity.js';
import { MatchmakingEntry } from './matchmaking-queue.entity.js';
import { MatchmakingController } from './matchmaking.controller.js';
import { MatchmakingService } from './matchmaking.service.js';
import { HttpAuthModule } from '../common/http-auth.module.js';

/**
 * Matchmaking queue: players join / leave a queue per time control and are
 * paired into a new game, notified through the `MATCH_FOUND` event.
 *
 * Routes: `/matchmaking/*` (see spec §23–§24).
 */
@Module({
  imports: [HttpAuthModule, TypeOrmModule.forFeature([User, MatchmakingEntry])],
  controllers: [MatchmakingController],
  providers: [MatchmakingService],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
