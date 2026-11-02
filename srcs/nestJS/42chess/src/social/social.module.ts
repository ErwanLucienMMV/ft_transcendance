import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpAuthModule } from '../common/http-auth.module.js';
import { BlocksController } from './blocks.controller.js';
import { BlocksService } from './blocks.service.js';
import { ContactRules } from './contact-rules.js';
import { UserBlock } from './user-block.entity.js';
import { UserEvents } from './user-events.js';

/**
 * What players allow each other (blocks, friends-only messages), and the per-user events
 * pushed on their sockets.
 */
@Module({
  imports: [HttpAuthModule, TypeOrmModule.forFeature([UserBlock])],
  controllers: [BlocksController],
  providers: [UserEvents, ContactRules, BlocksService],
  exports: [UserEvents, ContactRules, BlocksService],
})
export class SocialModule {}
