import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { OAuthProviders } from './oauth-provider.js';

describe('Google and GitHub provider protocol', () => {
  const settings = {
    OAUTH_PUBLIC_URL: 'https://chess.example',
    OAUTH_GOOGLE_CLIENT_ID: 'google-id',
    OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
    OAUTH_GITHUB_CLIENT_ID: 'github-id',
    OAUTH_GITHUB_CLIENT_SECRET: 'github-secret',
  };
  const http = vi.fn();
  const providers = new OAuthProviders(
    new ConfigService(settings),
    http as unknown as typeof fetch,
  );
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it('keeps optional providers disabled without credentials', () => {
    expect(
      new OAuthProviders(
        new ConfigService({}),
        http as unknown as typeof fetch,
      ).enabled(),
    ).toEqual([]);
    expect(providers.enabled()).toEqual(['google', 'github']);
  });
  it.each(['google', 'github'] as const)(
    'sends state and S256 PKCE without exposing the %s secret',
    (name) => {
      const url = new URL(providers.authorization(name, 'state', 'verifier'));
      expect(url.protocol).toBe('https:');
      expect(url.searchParams.get('state')).toBe('state');
      expect(url.searchParams.get('redirect_uri')).toBe(
        `https://chess.example/api/v1/auth/oauth/${name}/callback`,
      );
      expect(url.searchParams.get('code_challenge')).toBe(
        createHash('sha256').update('verifier').digest('base64url'),
      );
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.toString()).not.toContain('secret');
    },
  );
  it('exchanges Google codes server-side and accepts only provider-verified email', async () => {
    http
      .mockResolvedValueOnce(json({ access_token: 'vendor-token' }))
      .mockResolvedValueOnce(
        json({
          sub: 'google-user',
          email: 'Alice@Example.com',
          email_verified: true,
        }),
      );
    await expect(
      providers.identity('google', 'code', 'verifier'),
    ).resolves.toEqual({ id: 'google-user', email: 'alice@example.com' });
    expect(http.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(http.mock.calls[0][1].body);
    expect(body.get('client_secret')).toBe('google-secret');
    expect(body.get('code_verifier')).toBe('verifier');
    expect(http.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer vendor-token',
    );
  });
  it('does not trust an unverified Google email', async () => {
    http
      .mockResolvedValueOnce(json({ access_token: 'vendor-token' }))
      .mockResolvedValueOnce(
        json({
          sub: 'google-user',
          email: 'alice@example.com',
          email_verified: false,
        }),
      );
    await expect(
      providers.identity('google', 'code', 'verifier'),
    ).resolves.toEqual({ id: 'google-user', email: null });
  });
  it('fetches the primary verified GitHub email separately from the profile', async () => {
    http
      .mockResolvedValueOnce(json({ access_token: 'vendor-token' }))
      .mockResolvedValueOnce(json({ id: 42, email: 'untrusted@example.com' }))
      .mockResolvedValueOnce(
        json([
          { email: 'unverified@example.com', primary: true, verified: false },
          { email: 'alice@example.com', primary: true, verified: true },
        ]),
      );
    await expect(
      providers.identity('github', 'code', 'verifier'),
    ).resolves.toEqual({ id: '42', email: 'alice@example.com' });
    expect(http.mock.calls[2][0]).toBe('https://api.github.com/user/emails');
  });
  it.each([
    json({ error: 'invalid_grant' }),
    json({}, 500),
    json({ access_token: '' }),
  ])('fails closed on provider token errors', async (response) => {
    http.mockResolvedValueOnce(response);
    await expect(
      providers.identity('google', 'bad', 'verifier'),
    ).rejects.toMatchObject({ status: 401 });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('does not allow an insecure public deployment origin', () => {
    expect(() =>
      new OAuthProviders(
        new ConfigService({
          ...settings,
          OAUTH_PUBLIC_URL: 'http://chess.example',
        }),
        http as unknown as typeof fetch,
      ).settings('google'),
    ).toThrow();
  });
});
