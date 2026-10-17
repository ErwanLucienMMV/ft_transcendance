import { Module } from '@nestjs/common';
import { BotEngineModule } from '../bots/bot-engine.module.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChessEngineService } from '../chess/chess-engine.service.js';
import { Game } from './game.entity.js';
import { GamePlayer } from './game-player.entity.js';
import { Move } from './move.entity.js';
import { GamesService } from './games.service.js';
import { GameStoreService } from './game-store.service.js';
import { GameRulesService } from './game-rules.service.js';
import { GameAgreementsService } from './game-agreements.service.js';
import { GameClocksService } from './clock/game-clocks.service.js';
import { GameTimeoutsService } from './clock/game-timeouts.service.js';
import { GamesController } from './games.controller.js';
import { GamePresenterService } from './game-presenter.service.js';
import { GameActorGuard } from './game-actor.guard.js';

/**
 * Core of the application: game lifecycle (WAITING → ACTIVE → FINISHED),
 * server-side move validation, clocks, resignation / draws and spectators.
 *
 * Exposes REST routes (`/games/*`) and the realtime WebSocket game events.
 * Move legality is delegated to the external chess engine, never trusted
 * from the client (see spec §6–§20 and §28).
 */
@Module({
	imports: [
		BotEngineModule,
		TypeOrmModule.forFeature([Game, GamePlayer, Move]),
	],
	providers: [
		GamePresenterService,
		GameActorGuard,
		GamesService,
		GameStoreService,
		GameRulesService,
		GameAgreementsService,
		GameClocksService,
		GameTimeoutsService,
		ChessEngineService,
	],
	exports: [GamesService, GamePresenterService, GameActorGuard],
	controllers: [GamesController],
})
export class GamesModule {}
