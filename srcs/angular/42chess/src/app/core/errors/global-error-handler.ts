import { ErrorHandler, inject, Injectable } from '@angular/core';
import { ErrorState } from './error-state';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly errors = inject(ErrorState);

  handleError(error: unknown): void {
    console.error(error);
    this.errors.reportUnexpected();
  }
}
