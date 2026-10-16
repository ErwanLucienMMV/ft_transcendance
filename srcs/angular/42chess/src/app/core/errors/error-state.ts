import { Injectable, signal } from '@angular/core';
import type { ApiError } from '../api/api-error';

@Injectable({ providedIn: 'root' })
export class ErrorState {
  private readonly currentMessage = signal<string | null>(null);
  readonly message = this.currentMessage.asReadonly();

  reportHttp(error: ApiError): void {
    this.currentMessage.set(
      error.statusCode === 0
        ? 'Unable to reach the server. Please try again.'
        : 'The server could not complete this request. Please try again.',
    );
  }

  reportUnexpected(): void {
    this.currentMessage.set('Something went wrong. Please try again.');
  }

  dismiss(): void {
    this.currentMessage.set(null);
  }
}
