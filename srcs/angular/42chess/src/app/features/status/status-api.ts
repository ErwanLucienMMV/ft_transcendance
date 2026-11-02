import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, of } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { ApiError } from '../../core/api/api-error';
import { handledErrors } from '../../core/api/api-error.interceptor';

export type ServiceName = 'database' | 'chess-engine' | 'bot' | 'mail';

export interface ServiceCheck {
  name: ServiceName;
  status: 'up' | 'down';
  latencyMs: number | null;
}

export interface BackupStatus {
  status: 'ok' | 'stale' | 'missing';
  lastSuccess: string | null;
  ageSeconds: number | null;
  maxAgeSeconds: number;
}

/** `GET /api/v1/health`: what the API reaches, checked at most every 10 seconds. */
export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  services: ServiceCheck[];
  backup: BackupStatus;
}

export const STATUS_REFRESH_MS = 30_000;

/** The page explains an outage itself: no error toast on top of it. */
const OUTAGE_ERRORS = handledErrors('HTTP_ERROR', 'NETWORK_ERROR', 'INTERNAL_SERVER_ERROR');

function isReport(value: unknown): value is HealthReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'services' in value &&
    Array.isArray((value as HealthReport).services)
  );
}

@Injectable({ providedIn: 'root' })
export class StatusApi {
  private readonly api = inject(ApiClient);

  /**
   * The health report, or null when the API does not answer. A 503 still
   * carries the report: the API is up but its database is not.
   */
  health(): Observable<HealthReport | null> {
    return this.api.get<HealthReport>('health', OUTAGE_ERRORS).pipe(
      catchError((error: unknown) => {
        // The API error interceptor keeps the HTTP response as the cause.
        const response = error instanceof ApiError ? error.cause : error;
        return of(
          response instanceof HttpErrorResponse && isReport(response.error) ? response.error : null,
        );
      }),
    );
  }
}
