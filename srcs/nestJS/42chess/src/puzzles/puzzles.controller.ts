import {
  Body,
  Controller,
  Get,
  HttpCode,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PaginationQueryDto } from '../common/pagination.js';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { gameActor } from '../games/game-actor.guard.js';
import { PuzzleMoveDto } from './dto/puzzle-move.dto.js';
import {
  PUZZLE_PROMOTIONS,
  PuzzleSquareMoveDto,
} from './dto/puzzle-square-move.dto.js';
import { PuzzlesService } from './puzzles.service.js';

@Controller('v1/puzzles')
export class PuzzlesController {
  constructor(private readonly puzzles: PuzzlesService) {}

  @Get('daily')
  @Header('Cache-Control', 'no-store')
  daily() {
    return this.puzzles.daily();
  }

  /** Earlier days' puzzles, with how the signed-in player did on each. */
  @Get('archive')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AccessTokenGuard)
  archive(@Req() request: Request, @Query() pagination: PaginationQueryDto) {
    return this.puzzles.archive(gameActor(request), pagination);
  }

  /** A puzzle already published as a daily puzzle; never the solution. */
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  published(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.puzzles.published(id);
  }

  /** The player's latest attempt at this puzzle, to resume it anywhere. */
  @Get(':id/progress')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AccessTokenGuard)
  progress(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.puzzles.progress(gameActor(request), id);
  }

  @Post(':id/attempts')
  @UseGuards(AccessTokenGuard)
  start(@Req() request: Request, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.puzzles.start(gameActor(request), id);
  }

  @Get('attempts/:id')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AccessTokenGuard)
  state(@Req() request: Request, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.puzzles.state(gameActor(request), id);
  }

  /** Spec §30. Plays on the caller's latest unfinished attempt, or starts one. */
  @Post(':id/move')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  move(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: PuzzleSquareMoveDto,
  ) {
    return this.puzzles.move(
      gameActor(request),
      id,
      `${input.from}${input.to}${input.promotion ? PUZZLE_PROMOTIONS[input.promotion] : ''}`,
    );
  }

  @Post('attempts/:id/hint')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  hint(@Req() request: Request, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.puzzles.hint(gameActor(request), id);
  }

  @Post('attempts/:id/solution')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  solution(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.puzzles.solution(gameActor(request), id);
  }

  @Post('attempts/:id/moves')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  play(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: PuzzleMoveDto,
  ) {
    return this.puzzles.play(gameActor(request), id, input.move, input.version);
  }
}
