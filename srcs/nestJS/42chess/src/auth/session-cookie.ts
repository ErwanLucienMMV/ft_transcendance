import { Injectable } from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';
import { REFRESH_TOKEN, SessionService } from './session.service.js';

export const REFRESH_COOKIE = 'refresh_token';
// Nginx serves the API under /api/v1; the browser only sends the cookie to auth routes.
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export function refreshCookieOptions(
  request: Request,
  maxAge: number,
): CookieOptions {
  return {
    httpOnly: true,
    // Behind Nginx the scheme arrives in X-Forwarded-Proto; plain HTTP stays usable locally.
    secure: request.secure || request.headers['x-forwarded-proto'] === 'https',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge,
  };
}

export function readRefreshCookie(request: Request): string {
  const values = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${REFRESH_COOKIE}=`));
  return values.length === 1 ? values[0].slice(REFRESH_COOKIE.length + 1) : '';
}

/** Moves a freshly issued refresh secret from the handler result into the cookie. */
@Injectable()
export class RefreshCookieInterceptor implements NestInterceptor {
  constructor(private readonly sessions: SessionService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    return next.handle().pipe(
      map((body: unknown) => {
        const secret =
          body && typeof body === 'object'
            ? (body as { [REFRESH_TOKEN]?: unknown })[REFRESH_TOKEN]
            : undefined;
        if (typeof secret === 'string') {
          const response = http.getResponse<Response>();
          response.cookie(
            REFRESH_COOKIE,
            secret,
            refreshCookieOptions(
              http.getRequest<Request>(),
              this.sessions.lifetime(),
            ),
          );
          response.setHeader('Cache-Control', 'no-store');
        }
        return body;
      }),
    );
  }
}
