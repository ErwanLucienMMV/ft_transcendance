import { Module } from '@nestjs/common';
import { GamesModule } from '../games/games.module.js';
import { BotsController } from './bots.controller.js';
@Module({ imports: [GamesModule], controllers: [BotsController] })
export class BotsModule {}
