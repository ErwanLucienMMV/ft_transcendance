import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL, isApiUrl } from '../api/api-base-url';
import { AuthSession } from './auth-session';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const base = inject(API_BASE_URL).replace(/\/+$/, '');
  const session = inject(AuthSession);
  const router = inject(Router);
  const token = session.token();
  // Public auth requests must keep their own wrong-credentials/verification errors.
  if (!token || !isApiUrl(request.url, base) || request.url.startsWith(`${base}/auth/`)) {
    return next(request);
  }
  return next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })).pipe(
    catchError((error) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && session.token() === token) {
        session.clear('Your session expired. Please sign in again.');
        void router.navigate(['/login'], { queryParams: { returnUrl: safeReturnUrl(router.url) } });
      }
      return throwError(() => error);
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
