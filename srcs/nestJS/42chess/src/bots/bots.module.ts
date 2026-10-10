import { Module } from '@nestjs/common';

/**
 * Games against bots (Stockfish), with backend-controlled difficulty.
 * Bots play through the same game system as humans: the game logic does not
 * know whether a player is a human or a bot.
 *
 * Routes: `POST /games/bot` (see spec §27).
 */
@Module({})
export class BotsModule {}
