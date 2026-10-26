import {
  Body,
  Controller,
  Get,
  HttpCode,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { gameActor } from '../games/game-actor.guard.js';
import { PuzzleMoveDto } from './dto/puzzle-move.dto.js';
import { PuzzlesService } from './puzzles.service.js';

@Controller('v1/puzzles')
export class PuzzlesController {
  constructor(private readonly puzzles: PuzzlesService) {}

  @Get('daily')
  @Header('Cache-Control', 'no-store')
  daily() {
    return this.puzzles.daily();
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
