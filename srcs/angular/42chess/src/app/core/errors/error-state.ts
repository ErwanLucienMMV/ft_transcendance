import { inject, Injectable } from '@angular/core';
import type { ApiError } from '../api/api-error';
import { errorText } from '../api/error-text';
import { tr } from '../i18n/i18n';
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
    this.toasts.error(errorText(error, tr('errors.request')), {
      key: 'http',
      ...(error.statusCode === 0 || error.statusCode >= 500
        ? { link: { label: tr('common.serviceStatus'), path: '/status' } }
        : {}),
    });
  }

  reportUnexpected(): void {
    this.toasts.error(tr('errors.unexpected'), { key: 'unexpected' });
  }
}
