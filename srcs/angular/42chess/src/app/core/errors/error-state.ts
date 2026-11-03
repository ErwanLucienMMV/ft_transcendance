import { inject, Injectable } from '@angular/core';
import type { ApiError } from '../api/api-error';
import { errorText } from '../api/error-text';
import { Toasts } from '../../shared/ui/toasts';

/**
 * Failures no feature explains itself (server errors, a lost connection, a bug) become an
 * error toast. It goes away by itself, when dismissed, or when the player changes page.
 */
@Injectable({ providedIn: 'root' })
export class ErrorState {
  private readonly toasts = inject(Toasts);

  /** Says what failed (connection, server, a service) and where to check the service status. */
  reportHttp(error: ApiError): void {
    this.toasts.error(
      errorText(error, 'The server could not complete this request. Please try again.'),
      {
        key: 'http',
        ...(error.statusCode === 0 || error.statusCode >= 500
          ? { link: { label: 'Service status', path: '/status' } }
          : {}),
      },
    );
  }

  reportUnexpected(): void {
    this.toasts.error('Something went wrong. Please try again.', { key: 'unexpected' });
  }
}
