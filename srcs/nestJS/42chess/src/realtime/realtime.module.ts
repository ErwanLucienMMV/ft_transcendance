import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway.js';
import {
  RealtimeAuthenticator,
  UnavailableRealtimeAuthenticator,
} from './realtime-authenticator.js';
import { RealtimeMessages } from './realtime-messages.js';
import { GamesModule } from '../games/games.module.js';
import { GameRealtimeService } from './game-realtime.service.js';

@Module({
  imports: [ConfigModule, GamesModule],
  providers: [
    RealtimeGateway,
    { provide: RealtimeMessages, useClass: GameRealtimeService },
    {
      provide: RealtimeAuthenticator,
      useClass: UnavailableRealtimeAuthenticator,
    },
  ],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
