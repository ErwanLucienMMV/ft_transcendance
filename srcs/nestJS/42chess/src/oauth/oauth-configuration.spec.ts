import { ConfigService } from '@nestjs/config';
import { OAuthProviders } from './oauth-provider.js';

describe('SEC-14 OAuth deployment configuration', () => {
  const config = {
    APPURL: 'https://chess.example',
    GOOGLE_CLIENT_ID: 'fixture-google-id',
    GOOGLE_CLIENT_SECRET: 'fixture-google-secret',
    GITHUB_CLIENT_ID: 'fixture-github-id',
    GITHUB_CLIENT_SECRET: 'fixture-github-secret',
  };
  const http = vi.fn();
  const providers = (values: Record<string, unknown>) =>
    new OAuthProviders(new ConfigService(values), http as typeof fetch);

  it.each(['google', 'github'] as const)(
    'accepts Compose legacy variables for %s',
    (name) => {
      expect(providers(config).settings(name)).toEqual({
        id: `fixture-${name}-id`,
        secret: `fixture-${name}-secret`,
        callback: `https://chess.example/api/v1/auth/oauth/${name}/callback`,
      });
    },
  );
  it.each(['google', 'github'] as const)(
    'prefers explicit OAUTH_ credentials for %s',
    (name) => {
      const prefix = `OAUTH_${name.toUpperCase()}`;
      expect(
        providers({
          ...config,
          [`${prefix}_CLIENT_ID`]: 'preferred-id',
          [`${prefix}_CLIENT_SECRET`]: 'preferred-secret',
        }).settings(name),
      ).toMatchObject({ id: 'preferred-id', secret: 'preferred-secret' });
    },
  );
  it.each(['CLIENT_ID', 'CLIENT_SECRET'] as const)(
    'disables an incomplete provider missing %s without hiding another provider',
    (suffix) => {
      const p = providers({ ...config, [`GOOGLE_${suffix}`]: '' });
      expect(p.enabled()).toEqual(['github']);
      expect(() => p.settings('google')).toThrow('not configured');
      expect(http).not.toHaveBeenCalled();
    },
  );
  it.each([
    '',
    'http://chess.example',
    'https://user:password@chess.example',
    'https://chess.example/path',
    'https://chess.example?redirect=evil',
    'https://chess.example#fragment',
    'javascript:alert(1)',
    'http://localhost.evil.example',
    'http://127.0.0.1.evil.example',
  ])(
    'fails closed for invalid public origin %j without exposing credentials',
    (origin) => {
      const p = providers({ ...config, APPURL: origin });
      expect(p.enabled()).toEqual([]);
      try {
        p.settings('google');
        throw new Error('Expected configuration rejection');
      } catch (error) {
        expect(error).toMatchObject({
          response: { statusCode: 503, code: 'OAUTH_DISABLED' },
        });
        expect(JSON.stringify(error)).not.toContain(
          config.GOOGLE_CLIENT_SECRET,
        );
      }
    },
  );
  it.each([
    'http://localhost:4200',
    'http://127.0.0.1:4200',
    'https://chess.example/',
  ])('accepts supported development or deployment origin %s', (origin) => {
    expect(
      providers({ ...config, OAUTH_PUBLIC_URL: origin }).settings('google')
        .callback,
    ).toBe(`${new URL(origin).origin}/api/v1/auth/oauth/google/callback`);
  });
  it('does not fall back to APPURL when an explicitly configured OAuth origin is unsafe', () => {
    expect(
      providers({
        ...config,
        OAUTH_PUBLIC_URL: 'http://evil.example',
      }).enabled(),
    ).toEqual([]);
  });
  it.each(['google', 'github'] as const)(
    'requires an optional %s callback to exactly match the public callback',
    (name) => {
      const key = `${name.toUpperCase()}_CALLBACK_URL`;
      const callback = `https://chess.example/api/v1/auth/oauth/${name}/callback`;
      expect(
        providers({ ...config, [key]: callback }).settings(name).callback,
      ).toBe(callback);
      for (const value of [
        `${callback}/`,
        `${callback}?code=secret`,
        'https://evil.example/callback',
        callback.replace('https:', 'http:'),
      ]) {
        const p = providers({ ...config, [key]: value });
        expect(p.enabled()).not.toContain(name);
        expect(() => p.settings(name)).toThrow('callback does not match');
      }
    },
  );
});
