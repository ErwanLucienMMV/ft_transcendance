import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { User } from '../users/user.entity.js';

/** Verify login access tokens before controllers consume request.user. */
@Injectable()
export class HttpAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly source: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: { id: string } }>();
    const token = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    )?.[1];
    let userId: string;
    try {
      if (!token) throw new Error('Missing bearer token');
      const claims = await this.jwt.verifyAsync<Record<string, unknown>>(
        token,
        {
          secret: this.config.getOrThrow<string>('JWT_SECRET'),
          algorithms: ['HS256'],
        },
      );
      if (
        typeof claims.sub !== 'string' ||
        !isUUID(claims.sub) ||
        typeof claims.exp !== 'number' ||
        claims.exp <= Date.now() / 1000 ||
        claims.typ !== undefined
      )
        throw new Error('Invalid access token');
      userId = claims.sub.toLowerCase();
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_REQUIRED',
        message: 'A valid access token is required.',
      });
    }
    const user = await this.source
      .getRepository(User)
      .findOneBy({ id: userId });
    if (!user)
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_REQUIRED',
        message: 'A valid account is required.',
      });
    if (!user.emailVerifiedAt)
      throw new ForbiddenException({
        statusCode: 403,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email before continuing.',
      });
    request.user = { id: userId };
    return true;
  }
}
