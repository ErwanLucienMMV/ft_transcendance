import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { SessionService } from './session.service.js';

@Controller('v1/auth')
@UseGuards(AuthGuard)
export class SessionController {
  constructor(private readonly sessions: SessionService) {}
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.sessions.revoke(request.session.sessionId, request.user.id);
  }
}
