import { Injectable, signal } from '@angular/core';
import type { ApiError } from '../api/api-error';
import { errorText } from '../api/error-text';

@Injectable({ providedIn: 'root' })
export class ErrorState {
  private readonly currentMessage = signal<string | null>(null);
  readonly message = this.currentMessage.asReadonly();

  /** Says what failed (API down, service unavailable, server bug) instead of a generic line. */
  reportHttp(error: ApiError): void {
    this.currentMessage.set(
      errorText(error, 'The server could not complete this request. Please try again.'),
    );
  }

  reportUnexpected(): void {
    this.currentMessage.set('Something went wrong. Please try again.');
  }

  dismiss(): void {
    this.currentMessage.set(null);
  }
}
