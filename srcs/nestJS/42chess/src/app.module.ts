import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ChessEngineService } from './chess/chess-engine.service.js';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MetricsController } from './metrics/metrics.controller.js';
import { ConfigModule } from '@nestjs/config';
import { configurationOptions } from './config/environment.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { FriendsModule } from './friends/friends.module.js';
import { GamesModule } from './games/games.module.js';
import { MatchmakingModule } from './matchmaking/matchmaking.module.js';
import { ChatModule } from './chat/chat.module.js';
import { RatingModule } from './rating/rating.module.js';
import { PuzzlesModule } from './puzzles/puzzles.module.js';
import { BotsModule } from './bots/bots.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot(configurationOptions),
    DatabaseModule,
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: '42chess',
    }),
    PrometheusModule.register(),
    AuthModule,
    UsersModule,
    FriendsModule,
    GamesModule,
    MatchmakingModule,
    ChatModule,
    RatingModule,
    PuzzlesModule,
    BotsModule,
  ],
  controllers: [AppController, MetricsController],
  providers: [AppService, ChessEngineService],
})
export class AppModule {}
