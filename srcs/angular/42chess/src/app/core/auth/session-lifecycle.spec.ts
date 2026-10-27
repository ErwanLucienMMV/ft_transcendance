import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthSession } from './auth-session';
import { SessionLifecycle } from './session-lifecycle';
import { RealtimeService } from '../realtime/realtime.service';
import { authInterceptor } from './auth.interceptor';

describe('Server session lifecycle', () => {
  let session: AuthSession, lifecycle: SessionLifecycle, http: HttpTestingController;
  const realtime = { disconnect: vi.fn() };
  const user = { id: 'alice', username: 'alice', elo: 1200 };
  const token = (suffix: string) =>
    `header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.${suffix}`;
  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: RealtimeService, useValue: realtime },
      ],
    });
    session = TestBed.inject(AuthSession);
    lifecycle = TestBed.inject(SessionLifecycle);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    session.clear();
  });
  it('sends the captured bearer even though local cleanup precedes subscription', () => {
    const accessToken = token('first');
    session.establish({ user, accessToken });
    const result = lifecycle.signOut();
    expect(session.authenticated()).toBe(false);
    expect(realtime.disconnect).toHaveBeenCalledOnce();
    result.subscribe();
    const req = http.expectOne('/api/v1/auth/logout');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${accessToken}`);
    req.flush(null, { status: 204, statusText: 'No Content' });
  });
  it('does not clear a replacement session when an older logout fails', () => {
    session.establish({ user, accessToken: token('old') });
    lifecycle.signOut().subscribe({ error: () => {} });
    const newer = token('new');
    session.establish({ user, accessToken: newer });
    http.expectOne('/api/v1/auth/logout').flush({}, { status: 500, statusText: 'Failure' });
    expect(session.token()).toBe(newer);
  });
  it('ignores current-user replies belonging to an older session', () => {
    session.establish({ user, accessToken: token('old') });
    let result: unknown;
    lifecycle.refreshUser().subscribe((value) => (result = value));
    const newer = token('new');
    session.establish({ user, accessToken: newer });
    http.expectOne('/api/v1/users/me').flush({ ...user, username: 'old-name' });
    expect(result).toBeNull();
    expect(session.user()?.username).toBe('alice');
  });
  it('updates the public user while keeping the same token', () => {
    const accessToken = token('same');
    session.establish({ user, accessToken });
    lifecycle.refreshUser().subscribe();
    http.expectOne('/api/v1/users/me').flush({ ...user, username: 'renamed' });
    expect(session.user()?.username).toBe('renamed');
    expect(session.token()).toBe(accessToken);
  });
  it('does not send anonymous current-user or logout calls', () => {
    lifecycle.signOut().subscribe();
    lifecycle.refreshUser().subscribe();
    http.expectNone('/api/v1/users/me');
    http.expectNone('/api/v1/auth/logout');
  });
});
