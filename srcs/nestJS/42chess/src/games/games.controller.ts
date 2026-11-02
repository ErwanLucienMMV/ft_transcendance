import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { CreateGameResponse } from '../common/types/api.js';
import { CreateGameDto } from './dto/create-game.dto.js';
import { GamesService } from './games.service.js';
import { GamePresenterService } from './game-presenter.service.js';
import { GameActorGuard, gameActor } from './game-actor.guard.js';
import type {
  GameMovesResponse,
  GameResponse,
  LiveGamesResponse,
} from './game-api.types.js';
import { LiveGamesService } from './live-games.service.js';

@Controller('v1/games')
export class GamesController {
  constructor(
    private readonly games: GamesService,
    private readonly presenter: GamePresenterService,
    private readonly live: LiveGamesService,
  ) {}
  @Post()
  @UseGuards(GameActorGuard)
  async create(
    @Req() request: Request,
    @Body() input: CreateGameDto,
  ): Promise<CreateGameResponse> {
    const { game } = await this.games.create(gameActor(request), {
      initialTime: input.timeControl.initialTime,
      increment: input.timeControl.increment,
      opponentId: input.opponentId,
    });
    return { gameId: game.id, status: 'WAITING' };
  }

  /** Active games to watch, with their spectators (spec §28). Before `:id`. */
  @Get('live')
  liveGames(): Promise<LiveGamesResponse> {
    return this.live.list();
  }

  /** Game state/history are public to support spectating (spec §§11,27). */
  @Get(':id')
  async state(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GameResponse> {
    return this.presenter.state(await this.games.settle(id));
  }

  @Get(':id/moves')
  async moves(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GameMovesResponse> {
    return this.presenter.moves(await this.games.get(id));
  }
}
