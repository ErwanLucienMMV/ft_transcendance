import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { PaginationQueryDto } from '../common/pagination.js';
import type { PaginatedResponse } from '../common/types/api.js';
import { GameHistoryService } from './game-history.service.js';
import type { GameHistoryItem } from './game-api.types.js';

/** Public game history, like GET /games/:id and the rating history (spec §§11,25). */
@Controller('v1/users')
export class GameHistoryController {
  constructor(private readonly history: GameHistoryService) {}

  @Get(':id/games')
  games(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedResponse<GameHistoryItem>> {
    return this.history.forUser(id, pagination);
  }
}
