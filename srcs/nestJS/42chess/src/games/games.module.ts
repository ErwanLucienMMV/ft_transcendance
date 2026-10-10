import { Module } from '@nestjs/common';

/**
 * Core of the application: game lifecycle (WAITING → ACTIVE → FINISHED),
 * server-side move validation, clocks, resignation / draws and spectators.
 *
 * Exposes REST routes (`/games/*`) and the realtime WebSocket game events.
 * Move legality is delegated to the external chess engine, never trusted
 * from the client (see spec §6–§20 and §28).
 */
@Module({})
export class GamesModule {}
