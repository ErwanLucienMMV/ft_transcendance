import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../core/api/api-base-url';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { Toasts } from '../../shared/ui/toasts';
import { HealthReport, StatusApi } from './status-api';

const report: HealthReport = {
  status: 'down',
  checkedAt: '2026-11-02T18:00:00.000Z',
  services: [{ name: 'database', status: 'down', latencyMs: null }],
  backup: { status: 'missing', lastSuccess: null, ageSeconds: null, maxAgeSeconds: 7200 },
};

describe('StatusApi', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [
        // The app's own error interceptor, which turns HTTP errors into ApiError.
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
      ],
    });
    return {
      api: TestBed.inject(StatusApi),
      http: TestBed.inject(HttpTestingController),
      toasts: TestBed.inject(Toasts),
    };
  }

  it('reads the report, even from a 503 (database down), without an error toast', () => {
    const { api, http, toasts } = setup();
    const answers: unknown[] = [];
    api.health().subscribe((value) => answers.push(value));
    http
      .expectOne('/api/v1/health')
      .flush(report, { status: 503, statusText: 'Service Unavailable' });
    expect(answers).toEqual([report]);
    expect(toasts.items()).toEqual([]);
  });

  it('answers null when the API does not answer', () => {
    const { api, http, toasts } = setup();
    const answers: unknown[] = [];
    api.health().subscribe((value) => answers.push(value));
    http
      .expectOne('/api/v1/health')
      .flush('Bad gateway', { status: 502, statusText: 'Bad Gateway' });
    expect(answers).toEqual([null]);
    expect(toasts.items()).toEqual([]);
  });
});
