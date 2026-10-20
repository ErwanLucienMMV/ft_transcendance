import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
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
  imports: [ConfigModule, JwtModule.register({}), PresenceModule],
  providers: [FriendsService, AccessTokenGuard],
  controllers: [FriendsController],
})
export class FriendsModule {}
