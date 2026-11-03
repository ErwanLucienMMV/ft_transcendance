import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { API_BASE_URL, isApiUrl } from '../api/api-base-url';
import { AuthSession } from './auth-session';
import { SessionRefresh } from './session-refresh';
import { tr } from '../i18n/i18n';

/** 401s about what the user typed, not about the session: a new token would not change them. */
const CREDENTIAL_ERRORS = new Set(['INVALID_PASSWORD', 'INVALID_2FA_CODE']);

function credentialError(error: HttpErrorResponse): boolean {
  const body: unknown = error.error;
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : null;
  return typeof code === 'string' && CREDENTIAL_ERRORS.has(code);
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const base = inject(API_BASE_URL).replace(/\/+$/, '');
  const session = inject(AuthSession);
  const router = inject(Router);
  const refresh = inject(SessionRefresh);
  const token = session.token();
  // Public auth requests must keep their own wrong-credentials/verification errors.
  if (!token || !isApiUrl(request.url, base) || request.url.startsWith(`${base}/auth/`)) {
    return next(request);
  }
  const send = (bearer: string) =>
    next(request.clone({ setHeaders: { Authorization: `Bearer ${bearer}` } }));
  return send(token).pipe(
    catchError((error) => {
      if (
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        credentialError(error) ||
        session.token() !== token
      )
        return throwError(() => error);
      // One renewal from the refresh cookie, then a single retry with the new token.
      return refresh.renew().pipe(
        switchMap((renewed) => {
          if (renewed && renewed !== token) return send(renewed);
          if (session.token() === token) session.clear(tr('auth.sessionExpired'));
          if (!session.token())
            void router.navigate(['/login'], {
              queryParams: { returnUrl: safeReturnUrl(router.url) },
            });
          return throwError(() => error);
        }),
      );
    }),
  );
};

export function safeReturnUrl(value: string | null): string {
  if (
    !value ||
    !/^\/(?!\/)/.test(value) ||
    /[\\%\r\n]/.test(value) ||
    /^\/(login|register|two-factor|verify-email)(?:[/?#]|$)/.test(value)
  )
    return '/session';
  return value;
}
