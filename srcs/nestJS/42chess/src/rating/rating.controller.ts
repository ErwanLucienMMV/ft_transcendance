import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { PaginationQueryDto } from '../common/pagination.js';
import { RatingHistoryService } from './rating-history.service.js';
import type { RatingHistoryResponse } from './rating.types.js';

/** Public rating data, consistent with public profiles and game history (§4, §25). */
@Controller('v1/users')
export class RatingController {
  constructor(private readonly history: RatingHistoryService) {}

  @Get(':id/rating-history')
  getHistory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() pagination: PaginationQueryDto,
  ): Promise<RatingHistoryResponse> {
    return this.history.forUser(id, pagination);
  }
}
