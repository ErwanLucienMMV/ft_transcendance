import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { HttpAuthGuard } from '../common/http-auth.guard.js';
import { gameActor } from '../games/game-actor.guard.js';
import { BlocksService } from './blocks.service.js';

/** The players the signed-in user blocked. */
@Controller('v1/blocks')
@UseGuards(HttpAuthGuard)
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  list(@Req() request: Request) {
    return this.blocks.list(gameActor(request));
  }

  /** Idempotent: blocking twice changes nothing. */
  @Put(':userId')
  @HttpCode(204)
  block(
    @Req() request: Request,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    return this.blocks.block(gameActor(request), userId.toLowerCase());
  }

  @Delete(':userId')
  @HttpCode(204)
  unblock(
    @Req() request: Request,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    return this.blocks.unblock(gameActor(request), userId.toLowerCase());
  }
}
