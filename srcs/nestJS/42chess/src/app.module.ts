import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ChessEngineService } from './chess/chess-engine.service.js';
import { MetricsModule } from './metrics/metrics.module.js';
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
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RateLimitModule } from './common/rate-limit.js';
import { createValidationPipe } from './common/validation.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { PresenceModule } from './presence/presence.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { OAuthModule } from './oauth/oauth.module.js';
import { SocialModule } from './social/social.module.js';
import { ProgressionModule } from './progression/progression.module.js';

@Module({
  imports: [
    ConfigModule.forRoot(configurationOptions),
    RateLimitModule,
    DatabaseModule,
    PresenceModule,
    MetricsModule,
    AuthModule,
    OAuthModule,
    UsersModule,
    SocialModule,
    ProgressionModule,
    FriendsModule,
    GamesModule,
    MatchmakingModule,
    ChatModule,
    RatingModule,
    PuzzlesModule,
    BotsModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ChessEngineService,
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
