import { Module } from '@nestjs/common';
import { SessionModule } from '../auth/session.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { FriendsService } from './friends.service.js';
import { FriendsController } from './friends.controller.js';

/**
 * Friendships and friend requests (send, accept, reject / cancel, remove).
 *
 * Routes: `/friends/*` (see spec §5).
 */
@Module({
  imports: [SessionModule, PresenceModule],
  providers: [FriendsService, AccessTokenGuard],
  controllers: [FriendsController],
})
export class FriendsModule {}
