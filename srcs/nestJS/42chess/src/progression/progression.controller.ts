import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { PaginationQueryDto } from '../common/pagination.js';
import { ProgressionService } from './progression.service.js';

/** Public: the leaderboard, a player's statistics and achievements, and the rules. */
@Controller('v1')
export class ProgressionController {
  constructor(private readonly progression: ProgressionService) {}

  @Get('leaderboard')
  leaderboard(@Query() pagination: PaginationQueryDto) {
    return this.progression.leaderboard(pagination);
  }

  @Get('progression/rules')
  rules() {
    return this.progression.rules();
  }

  @Get('users/:id/stats')
  stats(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.progression.stats(id);
  }

  @Get('users/:id/achievements')
  achievements(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.progression.progress(id);
  }
}
