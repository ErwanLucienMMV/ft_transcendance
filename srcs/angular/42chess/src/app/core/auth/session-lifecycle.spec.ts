import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionLifecycle } from './session-lifecycle';
import { SERVER_AUTH_CAPABILITIES } from './server-auth-capabilities';
import { AuthSession, AuthTokenResponse } from './auth-session';
import { authInterceptor } from './auth.interceptor';
import { RealtimeService } from '../realtime/realtime.service';

function token(seconds = 3600): AuthTokenResponse {
  return {
    user: { id: 'player', username: 'Ta2b', elo: 1000 },
    accessToken: `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + seconds }))}.x`,
  };
}
describe('Deferred server session integration', () => {
  let session: AuthSession;
  let http: HttpTestingController;
  const realtime = { disconnect: vi.fn() };
  function setup(enabled = false) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: realtime },
        ...(enabled
          ? [{ provide: SERVER_AUTH_CAPABILITIES, useValue: { logout: true, currentUser: true } }]
          : []),
      ],
    });
    session = TestBed.inject(AuthSession);
    http = TestBed.inject(HttpTestingController);
    session.establish(token());
    return TestBed.inject(SessionLifecycle);
  }
  afterEach(() => {
    http.verify();
    session.clear();
    vi.clearAllMocks();
  });
  it('clears local state immediately without calling absent server routes by default', () => {
    const lifecycle = setup();
    lifecycle.signOut().subscribe();
    expect(session.token()).toBeNull();
    expect(realtime.disconnect).toHaveBeenCalledOnce();
    lifecycle.refreshUser().subscribe((user) => expect(user).toBeNull());
    http.expectNone(() => true);
  });
  it('preserves the captured bearer for server logout after local cleanup', () => {
    const lifecycle = setup(true),
      captured = session.token();
    lifecycle.signOut().subscribe();
    expect(session.token()).toBeNull();
    const request = http.expectOne('/api/v1/auth/logout');
    expect(request.request.headers.get('Authorization')).toBe(`Bearer ${captured}`);
    request.flush(null);
  });
  it('keeps the tab signed out even when server logout fails', () => {
    const lifecycle = setup(true),
      error = vi.fn();
    lifecycle.signOut().subscribe({ error });
    http.expectOne('/api/v1/auth/logout').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(error).toHaveBeenCalledOnce();
    expect(session.authenticated()).toBe(false);
  });
  it('refreshes only the public current user of the existing session', () => {
    const lifecycle = setup(true);
    lifecycle.refreshUser().subscribe();
    const request = http.expectOne('/api/v1/users/me');
    expect(request.request.headers.has('Authorization')).toBe(true);
    request.flush({ id: 'player', username: 'updated', elo: 1100, privateData: 'never retain' });
    expect(session.user()).toEqual({ id: 'player', username: 'updated', elo: 1100 });
  });
  it('does not restore a signed-out session from a stale current-user response', () => {
    const lifecycle = setup(true),
      result = vi.fn();
    lifecycle.refreshUser().subscribe(result);
    const request = http.expectOne('/api/v1/users/me');
    session.clear();
    request.flush({ id: 'player', username: 'updated', elo: 1100 });
    expect(result).toHaveBeenCalledWith(null);
    expect(session.authenticated()).toBe(false);
  });
  it('does not accept an identity mismatch from current-user', () => {
    const lifecycle = setup(true),
      error = vi.fn();
    lifecycle.refreshUser().subscribe({ error });
    http.expectOne('/api/v1/users/me').flush({ id: 'other', username: 'other', elo: 1000 });
    expect(error).toHaveBeenCalled();
    expect(session.user()?.id).toBe('player');
  });
  it('does not query current-user without a session even when enabled', () => {
    const lifecycle = setup(true);
    session.clear();
    lifecycle.refreshUser().subscribe((value) => expect(value).toBeNull());
    http.expectNone(() => true);
  });
});
