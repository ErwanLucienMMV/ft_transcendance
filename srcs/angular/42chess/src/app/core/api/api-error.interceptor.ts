import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ErrorState } from '../errors/error-state';
import { API_BASE_URL, isApiUrl } from './api-base-url';
import { ApiError } from './api-error';

export const apiErrorInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isApiUrl(request.url, inject(API_BASE_URL))) return next(request);
  const errors = inject(ErrorState);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) return throwError(() => error);
      const apiError = new ApiError(error);
      if (apiError.statusCode === 0 || apiError.statusCode >= 500) errors.reportHttp(apiError);
      // Validation/auth errors are handled by the feature that made the request.
      return throwError(() => apiError);
    }),
  );
};
