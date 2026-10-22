import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsDefined,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { TimeControlDto } from '../games/dto/create-game.dto.js';
import { GameActorGuard, gameActor } from '../games/game-actor.guard.js';
import { GamesService } from '../games/games.service.js';
import { GamePresenterService } from '../games/game-presenter.service.js';
import { BOT_DIFFICULTIES } from './bot-engine.js';
import type { BotDifficulty } from './bot-engine.js';
import { moveInput } from '../games/game-input.js';

export class CreateBotGameDto {
  @IsIn(BOT_DIFFICULTIES)
  difficulty: BotDifficulty;
  @IsOptional()
  @IsIn(['WHITE', 'BLACK'])
  color: 'WHITE' | 'BLACK' = 'WHITE';
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => TimeControlDto)
  timeControl: TimeControlDto;
}
export class BotGameMoveDto {
  @IsDefined()
  uci: string;
}
@Controller('v1/games')
@UseGuards(GameActorGuard)
export class BotsController {
  constructor(
    private readonly games: GamesService,
    private readonly presenter: GamePresenterService,
  ) {}
  @Post('bot')
  async create(@Req() request: Request, @Body() input: CreateBotGameDto) {
    const state = await this.games.createBot(
      gameActor(request),
      {
        initialTime: input.timeControl.initialTime,
        increment: input.timeControl.increment,
        color: input.color,
      },
      input.difficulty,
    );
    const response = await this.presenter.state(state);
    return { ...response, gameId: state.game.id };
  }
  @Post(':id/bot-move')
  async resume(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.presenter.state(
      await this.games.resumeBot(gameActor(request), id),
    );
  }
  // An explicit bot-game move endpoint until realtime game transport is merged.
  @Post(':id/bot/player-move')
  async play(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: BotGameMoveDto,
  ) {
    return this.presenter.state(
      await this.games.play(gameActor(request), id, moveInput(input.uci)),
    );
  }
}
