import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { gameActor } from '../games/game-actor.guard.js';
import { HttpAuthGuard } from '../common/http-auth.guard.js';
import { FriendsService } from './friends.service.js';
import type { FriendsResponse } from './friends.types.js';

@Controller('v1/friends')
@UseGuards(HttpAuthGuard)
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  list(@Req() request: Request): Promise<FriendsResponse> {
    return this.friends.list(gameActor(request));
  }
}
