import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { apiErrorInterceptor } from '../api/api-error.interceptor';
import { AuthSession, AuthTokenResponse } from './auth-session';
import { authInterceptor } from './auth.interceptor';
import { SessionRefresh } from './session-refresh';

const user = { id: 'user-1', username: 'Ta2b', elo: 1000 };
function response(seconds = 3600, suffix = 's'): AuthTokenResponse {
  return {
    user,
    accessToken: `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }))}.${suffix}`,
  };
}

describe('Session kept by the refresh cookie', () => {
  let session: AuthSession, refresh: SessionRefresh, http: HttpTestingController;
  function setup(platform = 'browser') {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([apiErrorInterceptor, authInterceptor])),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    session = TestBed.inject(AuthSession);
    refresh = TestBed.inject(SessionRefresh);
    http = TestBed.inject(HttpTestingController);
  }
  afterEach(() => {
    http.verify();
    session.clear();
    vi.useRealTimers();
  });

  it('restores the session after a reload', () => {
    setup();
    refresh.restore();
    expect(refresh.settled()).toBe(false);
    const req = http.expectOne('/api/v1/auth/refresh');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-Session-Refresh')).toBe('1');
    const restored = response();
    req.flush(restored);
    expect(session.token()).toBe(restored.accessToken);
    expect(refresh.settled()).toBe(true);
  });

  it('stays signed out, without a notice, when there is no usable cookie', () => {
    setup();
    refresh.restore();
    http.expectOne('/api/v1/auth/refresh').flush(null, { status: 204, statusText: 'No Content' });
    expect(session.authenticated()).toBe(false);
    expect(session.notice()).toBeNull();
    expect(refresh.settled()).toBe(true);
    refresh.restore();
    http.expectNone('/api/v1/auth/refresh');
  });

  it('never touches the cookie during server rendering', () => {
    setup('server');
    refresh.restore();
    http.expectNone('/api/v1/auth/refresh');
    expect(refresh.settled()).toBe(true);
  });

  it('renews one minute before the access token expires', () => {
    vi.useFakeTimers();
    setup();
    session.establish(response(120, 'first'));
    TestBed.tick();
    vi.advanceTimersByTime(59_000);
    http.expectNone('/api/v1/auth/refresh');
    vi.advanceTimersByTime(1_000);
    const renewed = response(3600, 'second');
    http.expectOne('/api/v1/auth/refresh').flush(renewed);
    expect(session.token()).toBe(renewed.accessToken);
  });

  it('shares one request between concurrent renewals', () => {
    setup();
    session.establish(response());
    const a = vi.fn(),
      b = vi.fn();
    refresh.renew().subscribe(a);
    refresh.renew().subscribe(b);
    const renewed = response(7200, 'shared');
    http.expectOne('/api/v1/auth/refresh').flush(renewed);
    expect(a).toHaveBeenCalledWith(renewed.accessToken);
    expect(b).toHaveBeenCalledWith(renewed.accessToken);
  });

  it('does not resurrect a session the user signed out of meanwhile', () => {
    setup();
    session.establish(response());
    refresh.renew().subscribe();
    session.clear();
    http.expectOne('/api/v1/auth/refresh').flush(response(7200, 'late'));
    expect(session.authenticated()).toBe(false);
  });

  it('keeps the current token on a network failure and tries again later', () => {
    vi.useFakeTimers();
    setup();
    const current = response(3600, 'kept');
    session.establish(current);
    TestBed.tick();
    refresh.renew().subscribe();
    http.expectOne('/api/v1/auth/refresh').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(session.token()).toBe(current.accessToken);
    vi.advanceTimersByTime(30_000);
    http.expectOne('/api/v1/auth/refresh').flush(response(3600, 'later'));
    expect(session.token()).not.toBe(current.accessToken);
  });
});
