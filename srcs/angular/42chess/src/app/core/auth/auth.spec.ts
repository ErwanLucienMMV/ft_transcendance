import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { AuthSession, AuthTokenResponse } from './auth-session';
import { authInterceptor, safeReturnUrl } from './auth.interceptor';
import { authGuard } from './auth.guard';
import { apiErrorInterceptor } from '../api/api-error.interceptor';
import { SessionRefresh } from './session-refresh';

const user = { id: 'user-1', username: 'Ta2b', elo: 1000 };
function response(seconds = 3600): AuthTokenResponse {
  return {
    user,
    accessToken: `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }))}.signature`,
  };
}

describe('Authentication lifecycle', () => {
  let auth: AuthService;
  let session: AuthSession;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([apiErrorInterceptor, authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(AuthService);
    session = TestBed.inject(AuthSession);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    session.clear();
    vi.useRealTimers();
  });

  it('does not authenticate an unverified registration', () => {
    auth
      .register({ username: 'Ta2b', email: 't@example.com', password: ' exact pass ' })
      .subscribe();
    const req = http.expectOne('/api/v1/auth/register');
    expect(req.request.body).toEqual({
      username: 'Ta2b',
      email: 't@example.com',
      password: ' exact pass ',
    });
    req.flush({ user });
    expect(session.authenticated()).toBe(false);
  });
  it('keeps the challenge separate until the second factor succeeds', () => {
    auth.login({ login: 'Ta2b', password: ' exact pass ' }).subscribe();
    const login = http.expectOne('/api/v1/auth/login');
    expect(login.request.body.password).toBe(' exact pass ');
    login.flush({ requires2fa: true, challengeToken: 'challenge' });
    expect(session.token()).toBeNull();
    expect(auth.needsTwoFactor()).toBe('challenge');
    auth.verifyTwoFactor('123456').subscribe();
    const verify = http.expectOne('/api/v1/auth/2fa/verify');
    expect(verify.request.body).toEqual({ challengeToken: 'challenge', code: '123456' });
    const token = response();
    verify.flush(token);
    expect(session.user()).toEqual(user);
    expect(session.token()).toBe(token.accessToken);
    expect(auth.needsTwoFactor()).toBeNull();
  });
  it('does not create a session after an incorrect TOTP code', () => {
    auth.login({ login: 'Ta2b', password: 'password' }).subscribe();
    http.expectOne('/api/v1/auth/login').flush({ requires2fa: true, challengeToken: 'challenge' });
    const error = vi.fn();
    auth.verifyTwoFactor('000000').subscribe({ error });
    http
      .expectOne('/api/v1/auth/2fa/verify')
      .flush({ code: 'INVALID_2FA_CODE' }, { status: 401, statusText: 'Unauthorized' });
    expect(error).toHaveBeenCalled();
    expect(session.authenticated()).toBe(false);
    auth.cancelChallenge();
    expect(() => auth.verifyTwoFactor('123456')).toThrow('Sign in again');
  });
  it('clears the previous session when starting a new login', () => {
    session.establish(response());
    auth.login({ login: 'other', password: 'password' }).subscribe({ error: () => {} });
    expect(session.token()).toBeNull();
    http.expectOne('/api/v1/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(session.authenticated()).toBe(false);
  });
  it('expires the memory session at the JWT expiry', () => {
    vi.useFakeTimers();
    session.establish(response(2));
    vi.advanceTimersByTime(2000);
    expect(session.token()).toBeNull();
    expect(session.notice()).toContain('expired');
  });
  it.each(['invalid', 'x.e30.x', response(-1).accessToken])(
    'refuses unusable tokens: %s',
    (token) => {
      expect(() => session.establish({ user, accessToken: token })).toThrow(
        'Invalid authentication response',
      );
      expect(session.authenticated()).toBe(false);
    },
  );
  it('verifies email and resends without acquiring an access token', () => {
    auth.verifyEmail('email-token').subscribe();
    const verify = http.expectOne('/api/v1/auth/verify-email');
    expect(verify.request.body).toEqual({ token: 'email-token' });
    verify.flush({ user });
    auth.resendVerification('t@example.com').subscribe();
    const resend = http.expectOne('/api/v1/auth/resend-verification');
    expect(resend.request.body).toEqual({ email: 't@example.com' });
    resend.flush(null, { status: 202, statusText: 'Accepted' });
    expect(session.token()).toBeNull();
  });
  it('adds a bearer only to the API boundary and excludes public auth', () => {
    const token = response();
    session.establish(token);
    const client = TestBed.inject(HttpClient);
    for (const url of [
      '/api/v1/games',
      '/api/v10/users',
      'https://example.com/api/v1/users',
      '/api/v1/auth/login',
    ]) {
      client.get(url).subscribe();
      const req = http.expectOne(url);
      expect(req.request.headers.get('Authorization')).toBe(
        url === '/api/v1/games' ? `Bearer ${token.accessToken}` : null,
      );
      req.flush({});
    }
  });
  it('clears on protected 401 once the cookie cannot renew, and redirects safely', () => {
    session.establish(response());
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const error = vi.fn();
    TestBed.inject(HttpClient).get('/api/v1/games').subscribe({ error });
    http.expectOne('/api/v1/games').flush({}, { status: 401, statusText: 'Unauthorized' });
    const renew = http.expectOne('/api/v1/auth/refresh');
    expect(renew.request.headers.get('X-Session-Refresh')).toBe('1');
    expect(renew.request.headers.get('Authorization')).toBeNull();
    renew.flush(null, { status: 204, statusText: 'No Content' });
    expect(session.token()).toBeNull();
    expect(session.notice()).toContain('expired');
    expect(error).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/' } });
  });
  it('renews once from the refresh cookie and retries the failed request', () => {
    session.establish(response());
    const next = vi.fn();
    TestBed.inject(HttpClient).get('/api/v1/games').subscribe(next);
    http.expectOne('/api/v1/games').flush({}, { status: 401, statusText: 'Unauthorized' });
    const renewed = response(7200);
    http.expectOne('/api/v1/auth/refresh').flush(renewed);
    const retry = http.expectOne('/api/v1/games');
    expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${renewed.accessToken}`);
    retry.flush({ ok: true });
    expect(next).toHaveBeenCalledWith({ ok: true });
    expect(session.token()).toBe(renewed.accessToken);
  });
  it('does not let a stale 401 clear a newer session', () => {
    session.establish(response(100));
    TestBed.inject(HttpClient)
      .get('/api/v1/games')
      .subscribe({ error: () => {} });
    const old = http.expectOne('/api/v1/games');
    const fresh = response(200);
    session.establish(fresh);
    old.flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(session.token()).toBe(fresh.accessToken);
  });
  it('waits for the cookie restore before redirecting a protected route', async () => {
    const guard = () =>
      TestBed.runInInjectionContext(() => authGuard({} as never, { url: '/session' } as never));
    const pending = guard() as Observable<unknown>;
    expect(isObservable(pending)).toBe(true);
    const decision = firstValueFrom(pending);
    TestBed.inject(SessionRefresh).restore();
    http.expectOne('/api/v1/auth/refresh').flush(null, { status: 204, statusText: 'No Content' });
    TestBed.tick();
    expect(await decision).toBeInstanceOf(UrlTree);
    expect(guard()).toBeInstanceOf(UrlTree);
    session.establish(response());
    expect(guard()).toBe(true);
  });
  it('lets a protected route through when the cookie restores the session', async () => {
    const decision = firstValueFrom(
      TestBed.runInInjectionContext(() =>
        authGuard({} as never, { url: '/session' } as never),
      ) as Observable<unknown>,
    );
    TestBed.inject(SessionRefresh).restore();
    http.expectOne('/api/v1/auth/refresh').flush(response());
    TestBed.tick();
    expect(await decision).toBe(true);
    expect(session.user()).toEqual(user);
  });
  it.each([
    '//evil.example',
    'https://evil.example',
    '/%2f%2fevil.example',
    '/login?returnUrl=/login',
    '/two-factor',
    '/\\evil',
    null,
  ])('rejects unsafe or looping return URLs: %s', (value) =>
    expect(safeReturnUrl(value)).toBe('/session'),
  );
});
