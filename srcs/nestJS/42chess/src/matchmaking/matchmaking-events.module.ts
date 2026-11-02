import { Module } from '@nestjs/common';
import { PresenceModule } from '../presence/presence.module.js';
import { MatchmakingEvents } from './matchmaking-events.service.js';
@Module({
  imports: [PresenceModule],
  providers: [MatchmakingEvents],
  exports: [MatchmakingEvents],
})
export class MatchmakingEventsModule {}
