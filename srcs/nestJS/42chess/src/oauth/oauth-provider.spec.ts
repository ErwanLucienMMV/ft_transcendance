import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { OAuthProviders } from './oauth-provider.js';

describe('Google, GitHub and 42 provider protocol', () => {
  const settings = {
    OAUTH_PUBLIC_URL: 'https://chess.example',
    OAUTH_GOOGLE_CLIENT_ID: 'google-id',
    OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
    OAUTH_GITHUB_CLIENT_ID: 'github-id',
    OAUTH_GITHUB_CLIENT_SECRET: 'github-secret',
    FORTYTWO_CLIENT_ID: 'intra-id',
    FORTYTWO_CLIENT_SECRET: 'intra-secret',
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
    expect(providers.enabled()).toEqual(['google', 'github', 'fortytwo']);
  });
  it('explains at startup why a provider button is hidden', () => {
    const lines = new OAuthProviders(
      new ConfigService({
        ...settings,
        GITHUB_CALLBACK_URL:
          'https://old.example/api/v1/auth/oauth/github/callback',
      }),
      http as unknown as typeof fetch,
    ).diagnose();
    expect(lines[0]).toBe(
      'Google sign-in enabled (callback https://chess.example/api/v1/auth/oauth/google/callback)',
    );
    expect(lines[1]).toContain('GitHub sign-in disabled, its button is hidden');
    expect(lines[1]).toContain(
      'callback does not match the public application URL',
    );
    expect(
      new OAuthProviders(
        new ConfigService({}),
        http as unknown as typeof fetch,
      ).diagnose()[0],
    ).toContain('This sign-in provider is not configured.');
  });
  it.each(['google', 'github', 'fortytwo'] as const)(
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
          given_name: 'Alice',
          picture: 'https://lh3.googleusercontent.com/a/alice',
        }),
      );
    await expect(
      providers.identity('google', 'code', 'verifier'),
    ).resolves.toEqual({
      id: 'google-user',
      email: 'alice@example.com',
      username: 'Alice',
      avatarUrl: 'https://lh3.googleusercontent.com/a/alice',
    });
    expect(http.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(http.mock.calls[0][1].body);
    expect(body.get('client_secret')).toBe('google-secret');
    expect(body.get('code_verifier')).toBe('verifier');
    expect(http.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer vendor-token',
    );
  });
  it('does not trust an unverified Google email, nor use any email for the username', async () => {
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
    ).resolves.toEqual({
      id: 'google-user',
      email: null,
      username: null,
      avatarUrl: null,
    });
  });
  it('fetches the primary verified GitHub email separately from the profile', async () => {
    http
      .mockResolvedValueOnce(json({ access_token: 'vendor-token' }))
      .mockResolvedValueOnce(
        json({
          id: 42,
          email: 'untrusted@example.com',
          login: 'alice-gh',
          avatar_url: 'http://insecure.example/a.png',
        }),
      )
      .mockResolvedValueOnce(
        json([
          { email: 'unverified@example.com', primary: true, verified: false },
          { email: 'alice@example.com', primary: true, verified: true },
        ]),
      );
    await expect(
      providers.identity('github', 'code', 'verifier'),
    ).resolves.toEqual({
      id: '42',
      email: 'alice@example.com',
      username: 'alice-gh',
      avatarUrl: null,
    });
    expect(http.mock.calls[2][0]).toBe('https://api.github.com/user/emails');
  });
  it('reads the 42 intranet profile: school email, login and picture', async () => {
    http
      .mockResolvedValueOnce(json({ access_token: 'intra-token' }))
      .mockResolvedValueOnce(
        json({
          id: 98765,
          email: 'alogin@student.42.fr',
          login: 'alogin',
          image: { link: 'https://cdn.intra.42.fr/users/alogin.jpg' },
        }),
      );
    await expect(
      providers.identity('fortytwo', 'code', 'verifier'),
    ).resolves.toEqual({
      id: '98765',
      email: 'alogin@student.42.fr',
      username: 'alogin',
      avatarUrl: 'https://cdn.intra.42.fr/users/alogin.jpg',
    });
    expect(http.mock.calls[0][0]).toBe('https://api.intra.42.fr/oauth/token');
    expect(http.mock.calls[1][0]).toBe('https://api.intra.42.fr/v2/me');
    expect(
      new URLSearchParams(http.mock.calls[0][1].body).get('client_secret'),
    ).toBe('intra-secret');
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
