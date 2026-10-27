import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OAUTH_NAVIGATE, OAuthService } from './oauth.service';
import { AuthService } from './auth.service';

describe('Optional OAuth client contract', () => {
  let oauth: OAuthService, auth: AuthService, http: HttpTestingController;
  const navigate = vi.fn();
  const user = { id: 'oauth-user', username: 'alice', elo: 1200 };
  const accessToken = `header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`;
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OAUTH_NAVIGATE, useValue: navigate },
      ],
    });
    oauth = TestBed.inject(OAuthService);
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    auth.session.clear();
  });
  it('exposes only server-enabled providers and uses the same-origin entry point', () => {
    expect(oauth.start('google')).toBe(false);
    oauth.loadProviders().subscribe();
    http
      .expectOne('/api/v1/auth/oauth/providers')
      .flush({ providers: ['google', 'github', 'unknown'] });
    expect(oauth.providers()).toEqual(['google', 'github']);
    expect(oauth.start('google')).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/api/v1/auth/oauth/google');
  });
  it('keeps local sign-in usable when provider discovery fails', () => {
    oauth.loadProviders().subscribe();
    http
      .expectOne('/api/v1/auth/oauth/providers')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(oauth.providers()).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('consumes the HttpOnly handoff with a CSRF header and stores the token only in memory', () => {
    oauth.exchange().subscribe();
    const req = http.expectOne('/api/v1/auth/oauth/exchange');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('x-oauth-exchange')).toBe('1');
    expect(req.request.body).toEqual({});
    req.flush({ accessToken, user });
    expect(auth.session.token()).toBe(accessToken);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('routes OAuth through the same 2FA challenge lifecycle', () => {
    oauth.exchange().subscribe();
    http
      .expectOne('/api/v1/auth/oauth/exchange')
      .flush({ requires2fa: true, challengeToken: 'challenge' });
    expect(auth.needsTwoFactor()).toBe('challenge');
    expect(auth.session.authenticated()).toBe(false);
  });
  it('attaches the current bearer to linking, listing and unlinking', () => {
    auth.session.establish({ accessToken, user });
    oauth.providers.set(['github']);
    oauth.link('github').subscribe();
    const link = http.expectOne('/api/v1/auth/oauth/github/link');
    expect(link.request.headers.get('Authorization')).toBe(`Bearer ${accessToken}`);
    link.flush({ authorizationUrl: 'https://github.com/login/oauth/authorize?state=opaque' });
    expect(navigate).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?state=opaque');
    oauth.accounts().subscribe();
    const accounts = http.expectOne('/api/v1/auth/oauth/accounts');
    expect(accounts.request.headers.get('Authorization')).toBe(`Bearer ${accessToken}`);
    accounts.flush({ providers: ['github'] });
    oauth.unlink('github').subscribe();
    const unlink = http.expectOne('/api/v1/auth/oauth/github');
    expect(unlink.request.method).toBe('DELETE');
    expect(unlink.request.headers.get('Authorization')).toBe(`Bearer ${accessToken}`);
    unlink.flush(null, { status: 204, statusText: 'No Content' });
  });
  it('refuses a provider redirect to an unrelated origin', () => {
    auth.session.establish({ accessToken, user });
    oauth.providers.set(['github']);
    const error = vi.fn();
    oauth.link('github').subscribe({ error });
    http
      .expectOne('/api/v1/auth/oauth/github/link')
      .flush({ authorizationUrl: 'https://evil.example' });
    expect(error).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
