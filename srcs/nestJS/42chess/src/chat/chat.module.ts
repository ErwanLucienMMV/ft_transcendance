import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpAuthModule } from '../common/http-auth.module.js';
import { SocialModule } from '../social/social.module.js';
import { Game } from '../games/game.entity.js';
import { GameMessage } from '../messages/game-messages.entity.js';
import { Message } from '../messages/messages.entity.js';
import { User } from '../users/user.entity.js';
import { ConversationsController } from './conversations.controller.js';
import { GameMessagesController } from './game-messages.controller.js';
import { GameMessagesService } from './game-messages.service.js';
import { PrivateMessagesService } from './private-messages.service.js';
import { PrivateMessageRealtime } from './private-message-realtime.js';

/**
 * In-game chat and private messages between users, delivered over
 * WebSocket and persisted in PostgreSQL.
 *
 * Routes: `/conversations/*` and `/games/:id/messages` (see spec §21–§22).
 */
@Module({
  imports: [
    HttpAuthModule,
    SocialModule,
    TypeOrmModule.forFeature([Message, GameMessage, Game, User]),
  ],
  controllers: [ConversationsController, GameMessagesController],
  providers: [
    PrivateMessagesService,
    PrivateMessageRealtime,
    GameMessagesService,
  ],
  exports: [
    PrivateMessagesService,
    PrivateMessageRealtime,
    GameMessagesService,
  ],
})
export class ChatModule {}
