import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import type { Request } from 'express';

/** Verifies the access token issued by AuthService before binding a principal. */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: { id: string } }>();
    const header = request.headers.authorization;
    try {
      if (!header?.startsWith('Bearer '))
        throw new Error('Missing access token');
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        header.slice(7),
        {
          algorithms: ['HS256'],
        },
      );
      if (
        typeof payload.sub !== 'string' ||
        !isUUID(payload.sub) ||
        typeof payload.username !== 'string' ||
        typeof payload.exp !== 'number' ||
        !Number.isFinite(payload.exp) ||
        payload.typ !== undefined
      ) {
        throw new Error('Not an access token');
      }
      request.user = { id: payload.sub.toLowerCase() };
      return true;
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_REQUIRED',
        message: 'A valid access token is required.',
      });
    }
  }
}
