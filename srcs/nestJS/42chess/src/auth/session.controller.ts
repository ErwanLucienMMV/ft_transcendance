import {
  Controller,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { bearerToken } from './auth.guard.js';
import {
  readRefreshCookie,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from './session-cookie.js';
import { invalidRefreshToken, SessionService } from './session.service.js';
import type { IssuedSession } from './session.service.js';

@Controller('v1/auth')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  /**
   * Restores or renews a session from the httpOnly refresh cookie. The custom header
   * cannot be sent by a cross-site form, and the cookie is SameSite=Strict anyway.
   * Having nothing to restore is a normal answer (204, cookie cleared), not an error:
   * every signed-out visit asks, and the subject forbids console errors.
   */
  @Post('refresh')
  @Header('Cache-Control', 'no-store')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<IssuedSession | undefined> {
    if (request.headers['x-session-refresh'] !== '1')
      throw invalidRefreshToken();
    try {
      const renewed = await this.sessions.refresh(readRefreshCookie(request));
      response.status(200);
      return renewed;
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      response.clearCookie(REFRESH_COOKIE, refreshCookieOptions(request, 0));
      response.status(204);
      return undefined;
    }
  }

  /**
   * Revokes the current session, identified by the bearer token or, once that has
   * expired, by the refresh cookie. Idempotent: the cookie is always cleared and the
   * answer is 204 even when nothing was left to revoke.
   */
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    response.clearCookie(REFRESH_COOKIE, refreshCookieOptions(request, 0));
    if (request.headers.authorization) {
      try {
        const session = await this.sessions.authenticate(
          bearerToken(request.headers.authorization),
        );
        await this.sessions.revoke(session.sessionId, session.user.id);
      } catch {
        // Fall back to the cookie below.
      }
    }
    const cookie = readRefreshCookie(request);
    if (cookie) await this.sessions.revokeRefresh(cookie);
  }
}
