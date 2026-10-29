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
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { createValidationPipe } from './common/validation.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { PresenceModule } from './presence/presence.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { OAuthModule } from './oauth/oauth.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot(configurationOptions),
    DatabaseModule,
    PresenceModule,
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: '42chess',
    }),
    PrometheusModule.register(),
    AuthModule,
    OAuthModule,
    UsersModule,
    FriendsModule,
    GamesModule,
    MatchmakingModule,
    ChatModule,
    RatingModule,
    PuzzlesModule,
    BotsModule,
    RealtimeModule,
  ],
  controllers: [AppController, MetricsController],
  providers: [
    AppService,
    ChessEngineService,
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
