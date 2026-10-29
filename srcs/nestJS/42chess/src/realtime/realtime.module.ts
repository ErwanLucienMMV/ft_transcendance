import { PresenceModule } from '../presence/presence.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeAuthenticator } from './realtime-authenticator.js';
import { SessionRealtimeAuthenticator } from './session-realtime-authenticator.js';
import { SessionModule } from '../auth/session.module.js';
import { RealtimeMessages } from './realtime-messages.js';
import { GamesModule } from '../games/games.module.js';
import { GameRealtimeService } from './game-realtime.service.js';
import { MetricsModule } from '../metrics/metrics.module.js';

@Module({
  imports: [
    ConfigModule,
    GamesModule,
    MetricsModule,
    SessionModule,
    PresenceModule,
  ],
  providers: [
    RealtimeGateway,
    { provide: RealtimeMessages, useClass: GameRealtimeService },
    {
      provide: RealtimeAuthenticator,
      useClass: SessionRealtimeAuthenticator,
    },
  ],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
