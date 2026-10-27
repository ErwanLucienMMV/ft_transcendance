import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';

export type { AuthenticatedRequest } from './auth.guard.js';

/** Profile routes share the session guard while preserving their error contract. */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly auth: AuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await this.auth.canActivate(context);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_REQUIRED',
        message: 'Authentication is required.',
      });
    }
  }
}
