import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { gameActor } from '../games/game-actor.guard.js';
import { JoinMatchmakingDto } from './dto/join-matchmaking.dto.js';
import { HttpAuthGuard } from '../common/http-auth.guard.js';
import { MatchmakingService } from './matchmaking.service.js';
import type { JoinMatchmakingResponse } from './matchmaking.types.js';

@Controller('v1/matchmaking')
@UseGuards(HttpAuthGuard)
export class MatchmakingController {
  constructor(private readonly matchmaking: MatchmakingService) {}

  @Post('join')
  join(
    @Req() request: Request,
    @Body() input: JoinMatchmakingDto,
  ): Promise<JoinMatchmakingResponse> {
    return this.matchmaking.join(gameActor(request), input.timeControl);
  }
}
