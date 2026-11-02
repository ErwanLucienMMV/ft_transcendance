import {
  HttpContext,
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ErrorState } from '../errors/error-state';
import { API_BASE_URL, isApiUrl } from './api-base-url';
import { ApiError } from './api-error';

/** Backend error codes the calling feature explains itself, so no global banner is shown. */
export const HANDLED_ERROR_CODES = new HttpContextToken<readonly string[]>(() => []);

/** Request context for a call whose feature shows its own message for these codes. */
export function handledErrors(...codes: string[]): { context: HttpContext } {
  return { context: new HttpContext().set(HANDLED_ERROR_CODES, codes) };
}

export const apiErrorInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isApiUrl(request.url, inject(API_BASE_URL))) return next(request);
  const errors = inject(ErrorState);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) return throwError(() => error);
      const apiError = new ApiError(error);
      const handled = request.context.get(HANDLED_ERROR_CODES).includes(apiError.code);
      if (!handled && (apiError.statusCode === 0 || apiError.statusCode >= 500)) {
        errors.reportHttp(apiError);
      }
      // Validation/auth errors are handled by the feature that made the request.
      return throwError(() => apiError);
    }),
  );
};
