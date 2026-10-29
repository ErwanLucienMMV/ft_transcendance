import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service.js';
import { PresenceGateway } from './presence.gateway.js';

@Module({
  providers: [PresenceService, PresenceGateway],
  exports: [PresenceService, PresenceGateway],
})
export class PresenceModule {}
