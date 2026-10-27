import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/access-token.guard.js';
import { FriendsService } from './friends.service.js';

@Controller('v1/friends')
@UseGuards(AccessTokenGuard)
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}
  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.friends.list(request.user.id);
  }
}
