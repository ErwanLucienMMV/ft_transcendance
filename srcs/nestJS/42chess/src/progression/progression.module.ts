import { Module } from '@nestjs/common';
import { UserEventsModule } from '../social/user-events.module.js';
import { ProgressionController } from './progression.controller.js';
import { ProgressionService } from './progression.service.js';

/** Experience, levels, the puzzle streak, achievements and the leaderboard. */
@Module({
  imports: [UserEventsModule],
  controllers: [ProgressionController],
  providers: [ProgressionService],
  exports: [ProgressionService],
})
export class ProgressionModule {}
