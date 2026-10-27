import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { generate, generateSecret } from 'otplib';
import { DataSource } from 'typeorm';
// Exercise the compiled application, including TypeScript decorator metadata.
import { AppModule } from './../dist/app.module.js';
import { MailClient } from './../dist/mail/mail.client.js';
import { MailUnavailableError } from './../dist/mail/mail.client.js';

/** Stands in for forgemail: keeps the last token sent to each address. */
class FakeMailClient {
  readonly tokens = new Map<string, string>();
  failing = false;

  sendEmailVerification(to: string, _username: string, token: string) {
    if (this.failing) {
      return Promise.reject(new MailUnavailableError());
    }
    this.tokens.set(to, token);
    return Promise.resolve();
  }
}

describe('/v1/auth (e2e)', () => {
  let app: INestApplication<App>;
  let database: DataSource;
  const mail = new FakeMailClient();
  const suffix = randomUUID().slice(0, 8);

  function body(overrides: Record<string, unknown> = {}) {
    return {
      username: `alice_${suffix}`,
      email: `alice_${suffix}@example.com`,
      password: 'correct-horse',
      ...overrides,
    };
  }

  function register(payload: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/v1/auth/register').send(payload);
  }

  function verify(token: string) {
    return request(app.getHttpServer())
      .post('/v1/auth/verify-email')
      .send({ token });
  }

  function resend(email: string) {
    return request(app.getHttpServer())
      .post('/v1/auth/resend-verification')
      .send({ email });
  }

  function login(payload: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/v1/auth/login').send(payload);
  }

  async function verificationState(username: string) {
    const [row] = await database.query(
      `SELECT "emailVerifiedAt", "emailVerificationTokenHash"
         FROM users WHERE username = $1`,
      [username],
    );
    return row as
      | {
          emailVerifiedAt: Date | null;
          emailVerificationTokenHash: string | null;
        }
      | undefined;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailClient)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates the account and returns only public fields', async () => {
    const response = await register(body()).expect(201);

    expect(response.body).toEqual({
      user: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        username: `alice_${suffix}`,
        elo: 1200,
      },
    });
  });

  it('stores an Argon2id hash and a lowercase email', async () => {
    const [row] = await database.query(
      'SELECT email, "passwordHash" FROM users WHERE username = $1',
      [`alice_${suffix}`],
    );

    expect(row.email).toBe(`alice_${suffix}@example.com`);
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects a taken username with 409', async () => {
    const response = await register(
      body({ email: `other_${suffix}@example.com` }),
    ).expect(409);

    expect(response.body.code).toBe('USERNAME_ALREADY_EXISTS');
  });

  it('rejects a username that only differs by case with 409', async () => {
    const response = await register(
      body({
        username: `ALICE_${suffix}`,
        email: `upper_${suffix}@example.com`,
      }),
    ).expect(409);

    expect(response.body.code).toBe('USERNAME_ALREADY_EXISTS');
  });

  it('rejects a reserved username with 400', async () => {
    const response = await register(
      body({ username: 'Admin', email: `admin_${suffix}@example.com` }),
    ).expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a disposable email with 400', async () => {
    const response = await register(
      body({ username: `temp_${suffix}`, email: `temp_${suffix}@yopmail.com` }),
    ).expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a taken email, whatever its case, with 409', async () => {
    const response = await register(
      body({
        username: `bob_${suffix}`,
        email: `ALICE_${suffix}@Example.com`,
      }),
    ).expect(409);

    expect(response.body.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('rejects an invalid body with 400', async () => {
    const response = await register(body({ password: 'short' })).expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('refuses fields the client must not set, such as elo', async () => {
    await register(body({ username: `eve_${suffix}`, elo: 3000 })).expect(400);
  });

  describe('email verification', () => {
    const name = `vera_${suffix}`;
    const email = `vera_${suffix}@example.com`;

    it('emails a token at registration and keeps the account unverified', async () => {
      await register(body({ username: name, email })).expect(201);

      expect(mail.tokens.get(email)).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect((await verificationState(name))?.emailVerifiedAt).toBeNull();
    });

    it('verifies the account with the emailed token, only once', async () => {
      const token = mail.tokens.get(email) as string;

      const response = await verify(token).expect(200);

      expect(response.body.user.username).toBe(name);
      const state = await verificationState(name);
      expect(state?.emailVerifiedAt).toBeInstanceOf(Date);
      expect(state?.emailVerificationTokenHash).toBeNull();
      const reuse = await verify(token).expect(400);
      expect(reuse.body.code).toBe('INVALID_VERIFICATION_TOKEN');
    });

    it('does not resend anything for a verified account, but still answers 202', async () => {
      mail.tokens.delete(email);

      await resend(email).expect(202);

      expect(mail.tokens.has(email)).toBe(false);
    });

    it('deletes an account whose token expired and frees its name', async () => {
      const late = `late_${suffix}`;
      const lateEmail = `late_${suffix}@example.com`;
      await register(body({ username: late, email: lateEmail })).expect(201);
      await database.query(
        `UPDATE users SET "emailVerificationExpiresAt" = now() - interval '1 minute'
          WHERE username = $1`,
        [late],
      );

      const response = await verify(mail.tokens.get(lateEmail) as string);

      expect(response.status).toBe(400);
      expect(await verificationState(late)).toBeUndefined();
      await register(body({ username: late, email: lateEmail })).expect(201);
    });

    it('sends a new working token on resend', async () => {
      const again = `again_${suffix}`;
      const againEmail = `again_${suffix}@example.com`;
      await register(body({ username: again, email: againEmail })).expect(201);
      const first = mail.tokens.get(againEmail) as string;

      await resend(againEmail.toUpperCase()).expect(202);

      const second = mail.tokens.get(againEmail) as string;
      expect(second).not.toBe(first);
      await verify(first).expect(400);
      await verify(second).expect(200);
    });

    it('creates no account when the email cannot be sent', async () => {
      const lost = `lost_${suffix}`;
      mail.failing = true;
      try {
        const response = await register(
          body({ username: lost, email: `lost_${suffix}@example.com` }),
        ).expect(503);

        expect(response.body.code).toBe('EMAIL_SERVICE_UNAVAILABLE');
        expect(await verificationState(lost)).toBeUndefined();
      } finally {
        mail.failing = false;
      }
    });

    it('rejects a malformed token with 400', async () => {
      const response = await verify('not-a-token').expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('login', () => {
    const name = `lena_${suffix}`;
    const email = `lena_${suffix}@example.com`;
    const pending = `paul_${suffix}`;

    beforeAll(async () => {
      await register(body({ username: name, email })).expect(201);
      await verify(mail.tokens.get(email) as string).expect(200);
      await register(
        body({ username: pending, email: `paul_${suffix}@example.com` }),
      ).expect(201);
    });

    function claims(token: string): Record<string, unknown> {
      const payload = token.split('.')[1];
      return JSON.parse(Buffer.from(payload, 'base64url').toString());
    }

    it('returns an access token and the public user fields', async () => {
      const response = await login({
        login: name,
        password: 'correct-horse',
      }).expect(200);

      expect(response.body).toEqual({
        accessToken: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
        user: {
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          username: name,
          elo: 1200,
        },
      });
      expect(claims(response.body.accessToken)).toMatchObject({
        sub: response.body.user.id,
        username: name,
      });
      // The refresh secret travels only in the httpOnly cookie, never in the body.
      const cookie = String(response.headers['set-cookie']);
      expect(cookie).toMatch(/^refresh_token=[0-9a-f-]{36}\.[\w-]{43};/);
      expect(cookie).toContain('Path=/api/v1/auth');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it.each([
      ['a username in another case', () => name.toUpperCase()],
      ['an email in another case', () => email.toUpperCase()],
    ])('accepts %s', async (_, identifier) => {
      const response = await login({
        login: identifier(),
        password: 'correct-horse',
      }).expect(200);

      expect(response.body.user.username).toBe(name);
    });

    it.each([
      ['a wrong password', () => ({ login: name, password: 'wrong-horse' })],
      [
        'an unknown login',
        () => ({ login: `ghost_${suffix}`, password: 'correct-horse' }),
      ],
    ])('rejects %s with the same 401', async (_, payload) => {
      const response = await login(payload()).expect(401);

      expect(response.body).toEqual({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid login or password',
      });
    });

    it('rejects an account whose email is not verified with 403', async () => {
      const response = await login({
        login: pending,
        password: 'correct-horse',
      }).expect(403);

      expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('rejects an invalid body with 400', async () => {
      const response = await login({ login: name }).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('two-factor login', () => {
    const secret = generateSecret();

    /** Registers a verified account with 2FA on (activation is AUTH-xx). */
    async function twoFactorAccount(name: string) {
      const email = `${name}@example.com`;
      await register(body({ username: name, email })).expect(201);
      await verify(mail.tokens.get(email) as string).expect(200);
      await database.query(
        `UPDATE users SET "twoFactorSecret" = $1, "twoFactorEnabledAt" = now()
          WHERE username = $2`,
        [secret, name],
      );
    }

    async function challengeFor(name: string): Promise<string> {
      const response = await login({
        login: name,
        password: 'correct-horse',
      }).expect(200);
      return response.body.challengeToken as string;
    }

    function verify2fa(challengeToken: string, code: string) {
      return request(app.getHttpServer())
        .post('/v1/auth/2fa/verify')
        .send({ challengeToken, code });
    }

    /** A code that is valid in none of the accepted periods. */
    async function wrongCode(): Promise<string> {
      const now = Date.now() / 1000;
      const valid = await Promise.all(
        [-30, 0, 30].map((offset) => generate({ secret, epoch: now + offset })),
      );
      let code = 0;
      while (valid.includes(String(code).padStart(6, '0'))) {
        code += 1;
      }
      return String(code).padStart(6, '0');
    }

    const tina = `tina_${suffix}`;

    beforeAll(async () => {
      await twoFactorAccount(tina);
    });

    it('answers a challenge instead of an access token', async () => {
      const response = await login({
        login: tina,
        password: 'correct-horse',
      }).expect(200);

      expect(response.body).toEqual({
        requires2fa: true,
        challengeToken: expect.any(String),
      });
    });

    it('gives the access token for a valid code, which then cannot be reused', async () => {
      const code = await generate({ secret });

      const response = await verify2fa(await challengeFor(tina), code).expect(
        200,
      );

      expect(response.body).toEqual({
        accessToken: expect.any(String),
        user: expect.objectContaining({ username: tina }),
      });
      const reuse = await verify2fa(await challengeFor(tina), code).expect(401);
      expect(reuse.body.code).toBe('INVALID_2FA_CODE');
    });

    it('refuses an access token as challenge', async () => {
      const plain = await login({
        login: `lena_${suffix}`,
        password: 'correct-horse',
      }).expect(200);

      const response = await verify2fa(
        plain.body.accessToken,
        await generate({ secret }),
      ).expect(401);

      expect(response.body.code).toBe('INVALID_2FA_CHALLENGE');
    });

    it('rejects a malformed code with 400', async () => {
      const response = await verify2fa(await challengeFor(tina), '12ab').expect(
        400,
      );

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('locks the code check after 5 wrong codes, even for a valid one', async () => {
      const locked = `lock_${suffix}`;
      await twoFactorAccount(locked);
      const challengeToken = await challengeFor(locked);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await verify2fa(challengeToken, await wrongCode());
        expect(response.status).toBe(401);
      }
      const response = await verify2fa(
        challengeToken,
        await generate({ secret }),
      ).expect(429);

      expect(response.body.code).toBe('TOO_MANY_2FA_ATTEMPTS');
      const [row] = await database.query(
        `SELECT "twoFactorFailedAttempts", "twoFactorLockedUntil"
           FROM users WHERE username = $1`,
        [locked],
      );
      expect(row.twoFactorFailedAttempts).toBe(0);
      expect(row.twoFactorLockedUntil.getTime()).toBeGreaterThan(
        Date.now() + 14 * 60 * 1000,
      );
    });
  });
});
