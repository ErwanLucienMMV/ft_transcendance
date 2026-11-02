import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { HttpAuthGuard } from '../common/http-auth.guard.js';
import { PaginationQueryDto } from '../common/pagination.js';
import { gameActor } from '../games/game-actor.guard.js';
import { PrivateMessagesService } from './private-messages.service.js';
import { PrivateMessageRealtime } from './private-message-realtime.js';

@Controller('v1/conversations')
@UseGuards(HttpAuthGuard)
export class ConversationsController {
  constructor(
    private readonly messages: PrivateMessagesService,
    private readonly realtime: PrivateMessageRealtime,
  ) {}

  @Get()
  list(@Req() request: Request) {
    return this.messages.conversations(gameActor(request));
  }

  /** Everything this player sent you is now read; they see it at once. */
  @Post(':userId/read')
  @HttpCode(204)
  async read(
    @Req() request: Request,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.realtime.markRead(gameActor(request), userId.toLowerCase());
  }

  @Get(':userId/messages')
  history(
    @Req() request: Request,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Query() page: PaginationQueryDto,
  ) {
    return this.messages.history(gameActor(request), userId, page);
  }
}
