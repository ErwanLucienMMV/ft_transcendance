import { Injectable, UnauthorizedException } from '@nestjs/common';
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
  canActivate(context: ExecutionContext): boolean {
    gameActor(
      context.switchToHttp().getRequest<Request & { user?: unknown }>(),
    );
    return true;
  }
}
