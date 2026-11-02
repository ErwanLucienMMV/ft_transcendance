import {
  Controller,
  Get,
  Param,
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

@Controller('v1/conversations')
@UseGuards(HttpAuthGuard)
export class ConversationsController {
  constructor(private readonly messages: PrivateMessagesService) {}

  @Get()
  list(@Req() request: Request) {
    return this.messages.conversations(gameActor(request));
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
