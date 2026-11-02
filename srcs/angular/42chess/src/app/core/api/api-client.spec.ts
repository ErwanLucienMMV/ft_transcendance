import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Toasts } from '../../shared/ui/toasts';
import { API_BASE_URL } from './api-base-url';
import { ApiClient } from './api-client';
import { ApiError } from './api-error';
import { apiErrorInterceptor, handledErrors } from './api-error.interceptor';

describe('API client and error boundary', () => {
  let api: ApiClient;
  let http: HttpTestingController;
  let toasts: Toasts;
  /** The text of the error toast, or null when none is shown. */
  const shown = () => toasts.items().find((toast) => toast.tone === 'error')?.text ?? null;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
    toasts = TestBed.inject(Toasts);
  });

  afterEach(() => http.verify());

  it('uses the public Nginx prefix and encodes query parameters', () => {
    const result = vi.fn();
    api
      .get<{ users: unknown[] }>('/users/search', { params: { q: 'a b&c', offset: 0 } })
      .subscribe(result);
    const request = http.expectOne((req) => req.url === '/api/v1/users/search');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('q')).toBe('a b&c');
    expect(request.request.urlWithParams).toContain('q=a%20b%26c');
    request.flush({ users: [] });
    expect(result).toHaveBeenCalledWith({ users: [] });
  });

  it('preserves the request body, including exact password characters', () => {
    const body = { login: 'Ta2b', password: '  exact password  ' };
    api.post('auth/login', body).subscribe();
    const request = http.expectOne('/api/v1/auth/login');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(body);
    request.flush({ accessToken: 'example' });
  });

  it('supports updates and deletions through the same prefix', () => {
    api.put('/users/me', { username: 'player' }).subscribe();
    const put = http.expectOne('/api/v1/users/me');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ username: 'player' });
    put.flush({});
    api.patch('users/me', { avatarUrl: null }).subscribe();
    const patch = http.expectOne('/api/v1/users/me');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ avatarUrl: null });
    patch.flush({});
    api.delete('friends/example').subscribe();
    const deletion = http.expectOne('/api/v1/friends/example');
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush(null);
  });

  it('supports a configured API prefix consistently', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: API_BASE_URL, useValue: '/backend/v1/' },
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(ApiClient).get('health').subscribe();
    http.expectOne('/backend/v1/health').flush({ status: 'ok' });
  });

  it.each([
    'https://example.com/users',
    '//example.com/users',
    '../users',
    'games/../users',
    'games/%2e%2e/users',
    'games\\users',
    'users?q=secret',
    'users#fragment',
  ])('refuses paths that escape the API boundary: %s', (path) => {
    expect(() => api.get(path)).toThrow('API paths must stay relative');
    http.expectNone(() => true);
  });

  it('preserves business errors and does not turn them into a global failure', () => {
    const failure = vi.fn();
    api.post('auth/register', {}).subscribe({ error: failure });
    http.expectOne('/api/v1/auth/register').flush(
      {
        statusCode: 409,
        code: 'USERNAME_ALREADY_EXISTS',
        message: 'Username already exists.',
        details: ['Choose another username.'],
      },
      { status: 409, statusText: 'Conflict' },
    );
    const error = failure.mock.calls[0][0] as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      statusCode: 409,
      code: 'USERNAME_ALREADY_EXISTS',
      message: 'Username already exists.',
      details: ['Choose another username.'],
    });
    expect(shown()).toBeNull();
  });

  it('uses the HTTP status even when the error body claims success', () => {
    const failure = vi.fn();
    api.get('users/me').subscribe({ error: failure });
    http.expectOne('/api/v1/users/me').flush(
      {
        statusCode: 200,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required.',
        details: [42],
      },
      { status: 401, statusText: 'Unauthorized' },
    );
    expect(failure.mock.calls[0][0]).toMatchObject({ statusCode: 401, code: 'AUTH_REQUIRED' });
    expect(failure.mock.calls[0][0].details).toBeUndefined();
    expect(shown()).toBeNull();
  });

  it('reports network failures while preserving the error for the caller', () => {
    const failure = vi.fn();
    api.get('health').subscribe({ error: failure });
    http.expectOne('/api/v1/health').error(new ProgressEvent('error'));
    expect(failure.mock.calls[0][0]).toMatchObject({ statusCode: 0, code: 'NETWORK_ERROR' });
    expect(shown()).toBe('Unable to reach the server. Check your connection, then try again.');
    expect(toasts.items()[0].link).toEqual({ label: 'Service status', path: '/status' });
    toasts.clear();
    expect(shown()).toBeNull();
  });

  it('shows a safe server failure message and does not retry a mutation', () => {
    const failure = vi.fn();
    api.post('games', {}).subscribe({ error: failure });
    http
      .expectOne('/api/v1/games')
      .flush('<html>private upstream details</html>', { status: 502, statusText: 'Bad Gateway' });
    expect(failure.mock.calls[0][0]).toMatchObject({ statusCode: 502, code: 'HTTP_ERROR' });
    expect(shown()).toBe('The server is not responding right now. Please try again in a moment.');
    expect(shown()).not.toContain('private');
    http.expectNone('/api/v1/games');
  });

  it('lets the calling feature explain the server error codes it handles', () => {
    const failure = vi.fn();
    api.get('puzzles/daily', handledErrors('PUZZLE_CATALOG_EMPTY')).subscribe({ error: failure });
    http.expectOne('/api/v1/puzzles/daily').flush(
      {
        statusCode: 503,
        code: 'PUZZLE_CATALOG_EMPTY',
        message: 'No validated puzzles are available.',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    expect(failure.mock.calls[0][0]).toMatchObject({
      statusCode: 503,
      code: 'PUZZLE_CATALOG_EMPTY',
    });
    expect(shown()).toBeNull();
  });

  it('still reports server errors outside the codes a feature handles', () => {
    const failure = vi.fn();
    api.get('puzzles/daily', handledErrors('PUZZLE_CATALOG_EMPTY')).subscribe({ error: failure });
    http
      .expectOne('/api/v1/puzzles/daily')
      .flush(
        { statusCode: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
        { status: 500, statusText: 'Internal Server Error' },
      );
    expect(shown()).toBe('Something went wrong on our side. Please try again in a moment.');
  });

  it('leaves non-API failures unchanged, including similarly prefixed URLs', () => {
    const failure = vi.fn();
    TestBed.inject(HttpClient).get('/api/v10/example').subscribe({ error: failure });
    http
      .expectOne('/api/v10/example')
      .flush('unavailable', { status: 503, statusText: 'Unavailable' });
    expect(failure.mock.calls[0][0]).toBeInstanceOf(HttpErrorResponse);
    expect(shown()).toBeNull();
  });
});
