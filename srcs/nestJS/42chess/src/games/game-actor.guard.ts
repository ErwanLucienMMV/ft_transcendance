import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { SessionService } from '../auth/session.service.js';
import { bearerToken } from '../auth/auth.guard.js';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import type { UUID } from '../common/types/api.js';

/** Authentication must populate request.user on the server after verifying the token.
 * This boundary does not decode tokens or take identities from client headers/body.
 * Until Auth supplies that principal, POST /games deliberately returns AUTH_REQUIRED.
 */
export function gameActor(request: Request & { user?: unknown }): UUID {
  const user = request.user;
  if (
    !user ||
    typeof user !== 'object' ||
    !('id' in user) ||
    typeof user.id !== 'string' ||
    !isUUID(user.id)
  )
    throw new UnauthorizedException({
      statusCode: 401,
      code: 'AUTH_REQUIRED',
      message: 'Authentication is required.',
    });
  return user.id.toLowerCase();
}

@Injectable()
export class GameActorGuard implements CanActivate {
  constructor(@Optional() private readonly sessions?: SessionService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    // A principal already installed by trusted server middleware is retained.
    // Network callers can only supply a bearer; they cannot populate request.user.
    if (!request.user && this.sessions) {
      try {
        const principal = await this.sessions.authenticate(
          bearerToken(request.headers.authorization),
        );
        request.user = principal.user;
      } catch (error) {
        // Preserve the game's public AUTH_REQUIRED contract for invalid actors.
        if (!(error instanceof UnauthorizedException)) throw error;
      }
    }
    gameActor(
      context.switchToHttp().getRequest<Request & { user?: unknown }>(),
    );
    return true;
  }
}
