import { randomUUID, createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../dist/app.module.js';
import { OAUTH_FETCH } from '../dist/oauth/oauth-provider.js';
import { OAuthFlow } from '../dist/oauth/oauth-flow.entity.js';
import { OauthAccount } from '../dist/oauth/oauth-accounts.entity.js';
import { User } from '../dist/users/user.entity.js';
import { SessionService } from '../dist/auth/session.service.js';
import { ConfigService } from '@nestjs/config';

describe('OAuth routes and durable account ownership (SCRUM-81..88/93/94)', () => {
  let app: INestApplication, source: DataSource, sessions: SessionService;
  const owned = new Set<string>(),
    suffix = randomUUID().slice(0, 8);
  let identity = {
    id: `oauth_${suffix}`,
    email: `oauth_${suffix}@example.com`,
  };
  const vendor = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/token') || url.endsWith('/access_token')) {
      const params = new URLSearchParams(init.body as string);
      if (params.get('code') === 'denied')
        return new Response(JSON.stringify({ error: 'invalid_grant' }));
      expect(params.get('code_verifier')).toMatch(/^[\w-]{43}$/);
      return new Response(
        JSON.stringify({ access_token: 'private-vendor-token' }),
      );
    }
    if (url.endsWith('/emails'))
      return new Response(
        JSON.stringify([
          { email: identity.email, verified: true, primary: true },
        ]),
      );
    return new Response(
      JSON.stringify(
        url.includes('googleapis')
          ? { sub: identity.id, email: identity.email, email_verified: true }
          : { id: identity.id },
      ),
    );
  });
  const env = {
    OAUTH_PUBLIC_URL: 'http://localhost:4200',
    OAUTH_GOOGLE_CLIENT_ID: 'test-google-id',
    OAUTH_GOOGLE_CLIENT_SECRET: 'test-google-secret',
    OAUTH_GITHUB_CLIENT_ID: 'test-github-id',
    OAUTH_GITHUB_CLIENT_SECRET: 'test-github-secret',
  };
  const original = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  beforeAll(async () => {
    Object.assign(process.env, env);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OAUTH_FETCH)
      .useValue(vendor)
      .compile();
    app = module.createNestApplication();
    await app.init();
    source = app.get(DataSource);
    sessions = app.get(SessionService);
  });
  afterAll(async () => {
    for (const id of owned) {
      await source.getRepository(OauthAccount).delete({ userId: id });
      await source.getRepository(User).delete(id);
    }
    await app?.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  async function start(
    agent: ReturnType<typeof request.agent>,
    provider: string,
  ) {
    const response = await agent.get(`/v1/auth/oauth/${provider}`).expect(302);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['cache-control']).toBe('no-store');
    const target = new URL(response.headers.location);
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    expect(target.toString()).not.toContain('secret');
    return target.searchParams.get('state')!;
  }
  async function callback(
    agent: ReturnType<typeof request.agent>,
    provider: string,
    state: string,
    code = 'allowed',
  ) {
    return agent
      .get(`/v1/auth/oauth/${provider}/callback`)
      .query({ state, code })
      .expect(302);
  }
  const exchange = (agent: ReturnType<typeof request.agent>) =>
    agent.post('/v1/auth/oauth/exchange').set('x-oauth-exchange', '1').send({});
  it.each(['google', 'github'])(
    'creates and reuses a %s account, hands tokens off only through JSON and prevents replay',
    async (provider) => {
      identity = {
        id: `${provider}_${suffix}`,
        email: `${provider}_${suffix}@example.com`,
      };
      const agent = request.agent(app.getHttpServer());
      const state = await start(agent, provider);
      const redirect = await callback(agent, provider, state);
      expect(redirect.headers.location).toBe(
        'http://localhost:4200/oauth/callback',
      );
      expect(redirect.headers.location).not.toMatch(/token|code=/);
      const first = await exchange(agent).expect(200);
      owned.add(first.body.user.id);
      expect(first.body).toMatchObject({
        accessToken: expect.any(String),
        user: { elo: 1200 },
      });
      await request(app.getHttpServer())
        .get('/v1/users/me')
        .auth(first.body.accessToken, { type: 'bearer' })
        .expect(200);
      await exchange(agent).expect(401);
      const again = await callback(agent, provider, state);
      expect(again.headers.location).toContain('error=failed');
      const next = await start(agent, provider);
      await callback(agent, provider, next);
      expect((await exchange(agent).expect(200)).body.user.id).toBe(
        first.body.user.id,
      );
    },
  );
  it('rejects callback CSRF and expired state before contacting the provider', async () => {
    const agent = request.agent(app.getHttpServer()),
      stranger = request.agent(app.getHttpServer());
    const state = await start(agent, 'google'),
      calls = vendor.mock.calls.length;
    expect(
      (await callback(stranger, 'google', state)).headers.location,
    ).toContain('error=failed');
    expect(vendor).toHaveBeenCalledTimes(calls);
    await source
      .getRepository(OAuthFlow)
      .update(createHash('sha256').update(state).digest('hex'), {
        expiresAt: new Date(0),
      });
    expect((await callback(agent, 'google', state)).headers.location).toContain(
      'error=failed',
    );
    expect(vendor).toHaveBeenCalledTimes(calls);
  });
  it('does not merge by email and links only through an authenticated, still-live session', async () => {
    identity = {
      id: `linked_${suffix}`,
      email: `existing_${suffix}@example.com`,
    };
    const user = await source.getRepository(User).save(
      source.getRepository(User).create({
        username: `existing_${suffix}`,
        email: identity.email,
        emailVerifiedAt: new Date(),
        passwordHash: 'test-existing-local-hash',
      }),
    );
    owned.add(user.id);
    const agent = request.agent(app.getHttpServer());
    const state = await start(agent, 'google');
    expect((await callback(agent, 'google', state)).headers.location).toContain(
      'error=existing-account',
    );
    expect(
      await source.getRepository(OauthAccount).countBy({ userId: user.id }),
    ).toBe(0);
    await agent.post('/v1/auth/oauth/google/link').expect(401);
    const session = await sessions.issue(user);
    const linked = await agent
      .post('/v1/auth/oauth/google/link')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(201);
    const linkState = new URL(linked.body.authorizationUrl).searchParams.get(
      'state',
    )!;
    await callback(agent, 'google', linkState);
    expect((await exchange(agent).expect(200)).body.user.id).toBe(user.id);
    await agent
      .delete('/v1/auth/oauth/google')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(204);
    expect(
      await source.getRepository(OauthAccount).countBy({ userId: user.id }),
    ).toBe(0);
    const stopped = await agent
      .post('/v1/auth/oauth/github/link')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/v1/auth/logout')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(204);
    expect(
      (
        await callback(
          agent,
          'github',
          new URL(stopped.body.authorizationUrl).searchParams.get('state')!,
        )
      ).headers.location,
    ).toContain('error=failed');
  });
  it('refuses removing the last login method and keeps 2FA mandatory for OAuth sign-in', async () => {
    identity = {
      id: `twofactor_${suffix}`,
      email: `twofactor_${suffix}@example.com`,
    };
    const agent = request.agent(app.getHttpServer()),
      state = await start(agent, 'google');
    await callback(agent, 'google', state);
    const response = await exchange(agent).expect(200);
    owned.add(response.body.user.id);
    await agent
      .delete('/v1/auth/oauth/google')
      .auth(response.body.accessToken, { type: 'bearer' })
      .expect(409);
    await source.getRepository(User).update(response.body.user.id, {
      twoFactorEnabledAt: new Date(),
      twoFactorSecret: 'JBSWY3DPEHPK3PXP',
    });
    await callback(agent, 'google', await start(agent, 'google'));
    const challenge = await exchange(agent).expect(200);
    expect(challenge.body).toMatchObject({
      requires2fa: true,
      challengeToken: expect.any(String),
    });
    expect(challenge.body).not.toHaveProperty('accessToken');
  });
  async function linkedAccount() {
    const key = randomUUID();
    const user = await source.getRepository(User).save({
      username: `unlink_${key.slice(0, 8)}`,
      email: `unlink_${key}@example.com`,
      emailVerifiedAt: new Date(),
      passwordHash: null,
    });
    owned.add(user.id);
    await source.getRepository(OauthAccount).insert(
      ['google', 'github'].map((provider) => ({
        userId: user.id,
        provider,
        providerUserId: `${provider}_${key}`,
      })),
    );
    return { user, token: (await sessions.issue(user)).accessToken };
  }

  it.each(['google', 'github'] as const)(
    'keeps the last usable login when %s is linked but disabled',
    async (disabled) => {
      const { user, token } = await linkedAccount();
      const remove = disabled === 'google' ? 'github' : 'google';
      const config = app.get(ConfigService);
      const keys = [
        `OAUTH_${disabled.toUpperCase()}_CLIENT_ID`,
        `${disabled.toUpperCase()}_CLIENT_ID`,
      ];
      const previous = keys.map((key) => ({
        key,
        value: config.get(key),
        env: process.env[key],
      }));
      try {
        for (const key of keys) config.set(key, '');
        const available = await request(app.getHttpServer())
          .get('/v1/auth/oauth/providers')
          .expect(200);
        expect(available.body.providers).not.toContain(disabled);
        expect(available.body.providers).toContain(remove);
        const response = await request(app.getHttpServer())
          .delete(`/v1/auth/oauth/${remove}`)
          .auth(token, { type: 'bearer' })
          .expect(409);
        expect(response.body.code).toBe('OAUTH_LAST_LOGIN_METHOD');
        expect(
          await source.getRepository(OauthAccount).countBy({ userId: user.id }),
        ).toBe(2);
        // Removing the unavailable link remains safe while the usable one stays.
        await request(app.getHttpServer())
          .delete(`/v1/auth/oauth/${disabled}`)
          .auth(token, { type: 'bearer' })
          .expect(204);
        expect(
          await source.getRepository(OauthAccount).findBy({ userId: user.id }),
        ).toMatchObject([{ provider: remove }]);
      } finally {
        for (const entry of previous) {
          config.set(entry.key, entry.value);
          if (entry.env === undefined) delete process.env[entry.key];
          else process.env[entry.key] = entry.env;
        }
      }
    },
  );

  it('allows unlinking when another configured provider remains and can sign in', async () => {
    const { user, token } = await linkedAccount();
    await request(app.getHttpServer())
      .delete('/v1/auth/oauth/google')
      .auth(token, { type: 'bearer' })
      .expect(204);
    const remaining = await source
      .getRepository(OauthAccount)
      .findOneByOrFail({ userId: user.id });
    identity = { id: remaining.providerUserId, email: user.email! };
    const agent = request.agent(app.getHttpServer());
    await callback(agent, 'github', await start(agent, 'github'));
    expect((await exchange(agent).expect(200)).body.user.id).toBe(user.id);
  });

  it('serializes concurrent unlink requests so one configured login remains', async () => {
    const { user, token } = await linkedAccount();
    const responses = await Promise.all(
      ['google', 'github'].map((provider) =>
        request(app.getHttpServer())
          .delete(`/v1/auth/oauth/${provider}`)
          .auth(token, { type: 'bearer' }),
      ),
    );
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([
      204, 409,
    ]);
    expect(
      responses.find((response) => response.status === 409)!.body.code,
    ).toBe('OAUTH_LAST_LOGIN_METHOD');
    expect(
      await source.getRepository(OauthAccount).countBy({ userId: user.id }),
    ).toBe(1);
  });
  it('rejects provider errors and an exchange without the CSRF header', async () => {
    const agent = request.agent(app.getHttpServer()),
      state = await start(agent, 'github');
    expect(
      (await callback(agent, 'github', state, 'denied')).headers.location,
    ).toContain('error=failed');
    await agent.post('/v1/auth/oauth/exchange').send({}).expect(401);
    await exchange(agent).expect(401);
  });
  it('binds the handoff to the originating browser and enforces its short expiry', async () => {
    identity = {
      id: `expiry_${suffix}`,
      email: `expiry_${suffix}@example.com`,
    };
    const agent = request.agent(app.getHttpServer());
    const state = await start(agent, 'google');
    const response = await callback(agent, 'google', state);
    const handoffCookie = response.headers['set-cookie']
      .find((value: string) => value.startsWith('oauth_handoff='))
      .split(';')[0];
    await request(app.getHttpServer())
      .post('/v1/auth/oauth/exchange')
      .set('x-oauth-exchange', '1')
      .set('Cookie', handoffCookie)
      .send({})
      .expect(401);
    const account = await source
      .getRepository(OauthAccount)
      .findOneByOrFail({ provider: 'google', providerUserId: identity.id });
    owned.add(account.userId);
    const handoff = handoffCookie.slice('oauth_handoff='.length);
    await source
      .getRepository(OAuthFlow)
      .update(createHash('sha256').update(handoff).digest('hex'), {
        expiresAt: new Date(0),
      });
    await exchange(agent).expect(401);
    expect(
      await source.query('SELECT id FROM auth_sessions WHERE "userId" = $1', [
        account.userId,
      ]),
    ).toEqual([]);
  });
  it('does not let a logged-in user take an identity already linked to another account', async () => {
    identity = {
      id: `ownership_${suffix}`,
      email: `ownership_${suffix}@example.com`,
    };
    const owner = request.agent(app.getHttpServer());
    await callback(owner, 'github', await start(owner, 'github'));
    const first = await exchange(owner).expect(200);
    owned.add(first.body.user.id);
    const attacker = await source
      .getRepository(User)
      .save(
        source
          .getRepository(User)
          .create({
            username: `attacker_${suffix}`,
            emailVerifiedAt: new Date(),
          }),
      );
    owned.add(attacker.id);
    const session = await sessions.issue(attacker);
    const agent = request.agent(app.getHttpServer());
    const started = await agent
      .post('/v1/auth/oauth/github/link')
      .auth(session.accessToken, { type: 'bearer' })
      .expect(201);
    expect(
      (
        await callback(
          agent,
          'github',
          new URL(started.body.authorizationUrl).searchParams.get('state')!,
        )
      ).headers.location,
    ).toContain('error=failed');
    expect(
      (
        await source
          .getRepository(OauthAccount)
          .findOneByOrFail({ provider: 'github', providerUserId: identity.id })
      ).userId,
    ).toBe(first.body.user.id);
    expect(
      await source.getRepository(OauthAccount).countBy({ userId: attacker.id }),
    ).toBe(0);
  });
});
