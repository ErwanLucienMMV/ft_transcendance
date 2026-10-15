import { Module } from '@nestjs/common';

/**
 * Matchmaking queue: players join / leave a queue per time control and are
 * paired into a new game, notified through the `MATCH_FOUND` event.
 *
 * Routes: `/matchmaking/*` (see spec §23–§24).
 */
@Module({})
export class MatchmakingModule {}
