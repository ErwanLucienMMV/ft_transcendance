import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { gameActor } from '../games/game-actor.guard.js';
import { HttpAuthGuard } from '../common/http-auth.guard.js';
import { FriendsService } from './friends.service.js';
import type {
  FriendRequestResponse,
  FriendRequestsResponse,
  FriendsResponse,
} from './friends.types.js';
import { SendFriendRequestDto } from './dto/send-friend-request.dto.js';

@Controller('v1/friends')
@UseGuards(HttpAuthGuard)
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  list(@Req() request: Request): Promise<FriendsResponse> {
    return this.friends.list(gameActor(request));
  }

  @Get('requests')
  receivedRequests(@Req() request: Request): Promise<FriendRequestsResponse> {
    return this.friends.receivedRequests(gameActor(request));
  }

  @Post('requests')
  sendRequest(
    @Req() request: Request,
    @Body() input: SendFriendRequestDto,
  ): Promise<FriendRequestResponse> {
    return this.friends.sendRequest(gameActor(request), input.recipientId);
  }

  @Post('requests/:requestId/accept')
  @HttpCode(200)
  acceptRequest(
    @Req() request: Request,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ): Promise<FriendRequestResponse> {
    return this.friends.acceptRequest(gameActor(request), requestId);
  }

  @Post('requests/:requestId/reject')
  @HttpCode(200)
  rejectRequest(
    @Req() request: Request,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ): Promise<FriendRequestResponse> {
    return this.friends.rejectRequest(gameActor(request), requestId);
  }

  @Delete(':friendId')
  @HttpCode(204)
  removeFriend(
    @Req() request: Request,
    @Param('friendId', new ParseUUIDPipe()) friendId: string,
  ): Promise<void> {
    return this.friends.removeFriend(gameActor(request), friendId);
  }
}
