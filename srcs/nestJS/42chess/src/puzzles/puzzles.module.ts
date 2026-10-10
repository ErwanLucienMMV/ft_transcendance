import { Module } from '@nestjs/common';

/**
 * Chess puzzles: daily puzzle selection, move checking and attempt tracking.
 * The solution is never sent to the client.
 *
 * Routes: `/puzzles/*` (see spec §30–§33).
 */
@Module({})
export class PuzzlesModule {}
