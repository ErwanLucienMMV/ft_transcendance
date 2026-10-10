import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
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
  let appliedMigrations = 0;
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
    appliedMigrations = (await database.runMigrations()).length;
  });

  afterAll(async () => {
    for (let i = 0; i < appliedMigrations; i++) {
      await database.undoLastMigration();
    }
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
});
