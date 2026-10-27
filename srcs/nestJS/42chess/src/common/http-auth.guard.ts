import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
/** Published HTTP routes use the same revocable sessions as REST and WebSocket. */
@Injectable()
export class HttpAuthGuard implements CanActivate {
  constructor(private readonly access: AccessTokenGuard) {}
  canActivate(context: ExecutionContext): Promise<boolean> {
    return this.access.canActivate(context);
  }
}
