import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../core/api/api-base-url';
import { apiErrorInterceptor } from '../../core/api/api-error.interceptor';
import { ErrorState } from '../../core/errors/error-state';
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
    const errors = TestBed.inject(ErrorState);
    vi.spyOn(errors, 'reportHttp');
    return {
      api: TestBed.inject(StatusApi),
      http: TestBed.inject(HttpTestingController),
      errors,
    };
  }

  it('reads the report, even from a 503 (database down), without the global banner', () => {
    const { api, http, errors } = setup();
    const answers: unknown[] = [];
    api.health().subscribe((value) => answers.push(value));
    http
      .expectOne('/api/v1/health')
      .flush(report, { status: 503, statusText: 'Service Unavailable' });
    expect(answers).toEqual([report]);
    expect(errors.reportHttp).not.toHaveBeenCalled();
  });

  it('answers null when the API does not answer', () => {
    const { api, http, errors } = setup();
    const answers: unknown[] = [];
    api.health().subscribe((value) => answers.push(value));
    http
      .expectOne('/api/v1/health')
      .flush('Bad gateway', { status: 502, statusText: 'Bad Gateway' });
    expect(answers).toEqual([null]);
    expect(errors.reportHttp).not.toHaveBeenCalled();
  });
});
