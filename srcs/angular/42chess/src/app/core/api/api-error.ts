import { HttpErrorResponse } from '@angular/common/http';

export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  details?: string[];
}

/** Preserves the backend error contract without treating HTTP failures as successes. */
export class ApiError extends Error implements ApiErrorResponse {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: string[];

  constructor(response: HttpErrorResponse) {
    const body: unknown = response.error;
    const payload =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const fallback =
      response.status === 0
        ? 'Unable to reach the server. Please try again.'
        : 'The request could not be completed.';
    super(typeof payload['message'] === 'string' ? payload['message'] : fallback, {
      cause: response,
    });
    this.name = 'ApiError';
    // The HTTP transport status is authoritative, even if a malformed body disagrees.
    this.statusCode = response.status;
    this.code =
      response.status === 0
        ? 'NETWORK_ERROR'
        : typeof payload['code'] === 'string'
          ? payload['code']
          : 'HTTP_ERROR';
    const details = payload['details'];
    if (Array.isArray(details) && details.every((item) => typeof item === 'string')) {
      this.details = [...details];
    }
  }
}
