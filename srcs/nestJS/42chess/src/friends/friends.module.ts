import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpAuthModule } from '../common/http-auth.module.js';
import { FriendsController } from './friends.controller.js';
import { FriendsService } from './friends.service.js';
import { Friendship } from './friendships.entity.js';

/** Friendships and friend requests (spec §5). */
@Module({
  imports: [HttpAuthModule, TypeOrmModule.forFeature([Friendship])],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
