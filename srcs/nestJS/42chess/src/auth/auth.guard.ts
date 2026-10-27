import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { invalidAccessToken, SessionService } from './session.service.js';
import type { SessionPrincipal } from './session.service.js';

export type AuthenticatedRequest = Request & {
  user: SessionPrincipal['user'];
  session: SessionPrincipal;
};
export function bearerToken(header: string | undefined): string {
  const match = header?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i);
  if (!match) throw invalidAccessToken();
  return match[1];
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.session = await this.sessions.authenticate(
      bearerToken(request.headers.authorization),
    );
    request.user = request.session.user;
    return true;
  }
}
