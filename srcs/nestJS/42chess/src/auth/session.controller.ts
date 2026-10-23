import {
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { SessionService } from './session.service.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class SessionController {
  constructor(private readonly sessions: SessionService) {}
  @Get('users/me')
  me(@Req() request: AuthenticatedRequest) {
    const u = request.user;
    return {
      id: u.id,
      username: u.username,
      elo: u.elo,
      email: u.email,
      avatarUrl: u.avatarUrl,
      gamesPlayed: u.gamesPlayed,
      gamesWon: u.gamesWon,
      gamesDraw: u.gamesDraw,
      gamesLost: u.gamesLost,
      createdAt: u.createdAt,
    };
  }
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.sessions.revoke(request.session.sessionId, request.user.id);
  }
}
