import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HttpAuthGuard } from '../common/http-auth.guard.js';
import { PaginationQueryDto } from '../common/pagination.js';
import { GameMessagesService } from './game-messages.service.js';

/** Chat history for a page that opens or reconnects; new messages arrive on the socket. */
@Controller('v1/games')
@UseGuards(HttpAuthGuard)
export class GameMessagesController {
  constructor(private readonly messages: GameMessagesService) {}

  @Get(':id/messages')
  history(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() page: PaginationQueryDto,
  ) {
    return this.messages.history(id, page);
  }
}
