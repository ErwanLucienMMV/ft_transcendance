import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpAuthModule } from '../common/http-auth.module.js';
import { Message } from '../messages/messages.entity.js';
import { User } from '../users/user.entity.js';
import { ConversationsController } from './conversations.controller.js';
import { PrivateMessagesService } from './private-messages.service.js';

/**
 * In-game chat and private messages between users, delivered over
 * WebSocket and persisted in PostgreSQL.
 *
 * Routes: `/conversations/*` (see spec §21–§22).
 */
@Module({
  imports: [HttpAuthModule, TypeOrmModule.forFeature([Message, User])],
  controllers: [ConversationsController],
  providers: [PrivateMessagesService],
  exports: [PrivateMessagesService],
})
export class ChatModule {}
