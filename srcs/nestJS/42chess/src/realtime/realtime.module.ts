import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway.js';
import {
  RealtimeAuthenticator,
  UnavailableRealtimeAuthenticator,
} from './realtime-authenticator.js';
import { RealtimeMessages } from './realtime-messages.js';

@Module({
  imports: [ConfigModule],
  providers: [
    RealtimeGateway,
    RealtimeMessages,
    {
      provide: RealtimeAuthenticator,
      useClass: UnavailableRealtimeAuthenticator,
    },
  ],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
