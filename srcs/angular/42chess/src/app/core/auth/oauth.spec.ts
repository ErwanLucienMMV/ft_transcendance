import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../api/api-base-url';
import { OAUTH_NAVIGATE, OAUTH_PROVIDERS, OAuthService } from './oauth.service';
import { OAuthSignIn } from '../../features/auth/oauth-sign-in';

describe('Deferred OAuth client entries', () => {
  const navigate = vi.fn();
  afterEach(() => vi.clearAllMocks());
  function setup(providers?: string[], base = '/api/v1', platform = 'browser') {
    TestBed.configureTestingModule({
      imports: [OAuthSignIn],
      providers: [
        { provide: OAUTH_NAVIGATE, useValue: navigate },
        { provide: API_BASE_URL, useValue: base },
        { provide: PLATFORM_ID, useValue: platform },
        ...(providers ? [{ provide: OAUTH_PROVIDERS, useValue: providers }] : []),
      ],
    });
    return TestBed.inject(OAuthService);
  }
  it('keeps absent providers unavailable by default', async () => {
    const oauth = setup();
    expect(oauth.start('google')).toBe(false);
    expect(oauth.start('github')).toBe(false);
    const fixture = TestBed.createComponent(OAuthSignIn);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
  it.each([
    ['google', '/api/v1/auth/oauth/google'],
    ['github', '/api/v1/auth/oauth/github'],
  ] as const)('starts %s through the same-origin API only when enabled', (provider, path) => {
    const oauth = setup([provider]);
    expect(oauth.start(provider)).toBe(true);
    expect(navigate).toHaveBeenCalledWith(path);
  });
  it('enables providers independently and keeps local login independent', async () => {
    const oauth = setup(['github']);
    expect(oauth.available('google')).toBe(false);
    expect(oauth.start('google')).toBe(false);
    const fixture = TestBed.createComponent(OAuthSignIn);
    await fixture.whenStable();
    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain('GitHub');
    buttons[0].click();
    expect(navigate).toHaveBeenCalledWith('/api/v1/auth/oauth/github');
  });
  it.each([
    'https://foreign.example/api',
    '//foreign.example/api',
    '/api/../outside',
    '/api?redirect=foreign',
  ])('refuses an unsafe API base: %s', (base) => {
    const oauth = setup(['google'], base);
    expect(oauth.start('google')).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('does not navigate during SSR', () => {
    const oauth = setup(['google'], '/api/v1', 'server');
    expect(oauth.start('google')).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('does not accept an unknown provider', () => {
    const oauth = setup(['google', 'unknown']);
    expect(oauth.start('unknown' as 'google')).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
  it('reports failed navigation without acquiring a session', async () => {
    setup(['google']);
    navigate.mockImplementationOnce(() => {
      throw new Error('Navigation unavailable');
    });
    const fixture = TestBed.createComponent(OAuthSignIn);
    await fixture.whenStable();
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'sign in with your password',
    );
  });
});
