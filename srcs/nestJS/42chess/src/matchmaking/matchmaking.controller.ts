import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { gameActor } from '../games/game-actor.guard.js';
import { JoinMatchmakingDto } from './dto/join-matchmaking.dto.js';
import { HttpAuthGuard } from '../common/http-auth.guard.js';
import { MatchmakingService } from './matchmaking.service.js';
import type {
  JoinMatchmakingResponse,
  QueueStatus,
} from './matchmaking.types.js';

@Controller('v1/matchmaking')
@UseGuards(HttpAuthGuard)
export class MatchmakingController {
  constructor(private readonly matchmaking: MatchmakingService) {}

  @Get('status')
  status(@Req() request: Request): Promise<QueueStatus> {
    return this.matchmaking.status(gameActor(request));
  }

  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(@Req() request: Request): Promise<QueueStatus> {
    return this.matchmaking.heartbeat(gameActor(request));
  }

  @Post('leave')
  @HttpCode(200)
  leave(@Req() request: Request): Promise<QueueStatus> {
    return this.matchmaking.leave(gameActor(request));
  }

  @Post('join')
  join(
    @Req() request: Request,
    @Body() input: JoinMatchmakingDto,
  ): Promise<JoinMatchmakingResponse> {
    return this.matchmaking.join(gameActor(request), input.timeControl);
  }
}
