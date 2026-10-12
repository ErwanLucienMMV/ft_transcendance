import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChessEngineService } from '../chess/chess-engine.service.js';
import { Game } from './game.entity.js';
import { GamePlayer } from './game-player.entity.js';
import { Move } from './move.entity.js';
import { GamesService } from './games.service.js';
import { GameStoreService } from './game-store.service.js';
import { GameRulesService } from './game-rules.service.js';

/**
 * Core of the application: game lifecycle (WAITING → ACTIVE → FINISHED),
 * server-side move validation, clocks, resignation / draws and spectators.
 *
 * Exposes REST routes (`/games/*`) and the realtime WebSocket game events.
 * Move legality is delegated to the external chess engine, never trusted
 * from the client (see spec §6–§20 and §28).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Game, GamePlayer, Move])],
  providers: [
    GamesService,
    GameStoreService,
    GameRulesService,
    ChessEngineService,
  ],
  exports: [GamesService],
})
export class GamesModule {}
