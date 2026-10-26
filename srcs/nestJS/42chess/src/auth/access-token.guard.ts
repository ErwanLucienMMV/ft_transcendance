import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import type { Environment } from '../config/environment.js';

export type AuthenticatedRequest = Request & { user: { id: string } };

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
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        match[1],
        {
          secret: this.config.get('JWT_SECRET', { infer: true }),
          algorithms: ['HS256'],
        },
      );
      if (
        typeof payload.sub !== 'string' ||
        !isUUID(payload.sub) ||
        typeof payload.exp !== 'number' ||
        !Number.isFinite(payload.exp) ||
        payload.typ !== undefined
      )
        throw new Error('Invalid access claims');
      request.user = { id: payload.sub.toLowerCase() };
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
