import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import type { Environment } from '../config/environment.js';

export type AuthenticatedRequest = Request & { user: { id: string } };

/** Shared HTTP/WebSocket verifier; challenge tokens never establish a session. */
export async function verifyAccessToken(
  jwt: JwtService,
  secret: string,
  token: string,
) {
  const payload = await jwt.verifyAsync<Record<string, unknown>>(token, {
    secret,
    algorithms: ['HS256'],
  });
  if (
    typeof payload.sub !== 'string' ||
    !isUUID(payload.sub) ||
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp) ||
    payload.typ !== undefined
  )
    throw new Error('Invalid access claims');
  return { id: payload.sub.toLowerCase(), expiresAt: payload.exp * 1000 };
}

/** Accept only signed, expiring access tokens, using the login signing key. */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    try {
      if (!match) throw new Error('Missing bearer token');
      const subject = await verifyAccessToken(
        this.jwt,
        this.config.get('JWT_SECRET', { infer: true }),
        match[1],
      );
      request.user = { id: subject.id };
      return true;
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_REQUIRED',
        message: 'Authentication is required.',
      });
    }
  }
}
