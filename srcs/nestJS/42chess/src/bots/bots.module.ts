import { Module } from '@nestjs/common';
import { GamesModule } from '../games/games.module.js';
import { SessionModule } from '../auth/session.module.js';
import { BotsController } from './bots.controller.js';
// GameActorGuard is built in this module: without SessionService it rejects every bearer.
@Module({
  imports: [GamesModule, SessionModule],
  controllers: [BotsController],
})
export class BotsModule {}
