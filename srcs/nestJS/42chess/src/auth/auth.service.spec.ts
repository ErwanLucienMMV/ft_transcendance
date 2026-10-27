import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { MailClient, MailUnavailableError } from '../mail/mail.client.js';
import {
  DuplicateUserFieldError,
  UsersService,
} from '../users/users.service.js';
import {
  AuthService,
  TWO_FACTOR_LOCK_MS,
  TWO_FACTOR_MAX_ATTEMPTS,
} from './auth.service.js';
import { hashVerificationToken } from './email-verification-token.js';
import { PasswordService } from './password.service.js';
import { TotpService } from './totp.service.js';
import { TwoFactorChallengeService } from './two-factor-challenge.service.js';
import { SessionService } from './session.service.js';

const DTO = {
  username: 'alice',
  email: 'alice@example.com',
  password: 'correct-horse',
};

const ALICE = {
  id: 'uuid',
  username: 'alice',
  email: 'alice@example.com',
  elo: 1200,
};

const MINUTE = 60 * 1000;

const JWT_SECRET = 'unit-test-jwt-secret-of-32-chars!';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  return (await promise.catch((error: unknown) => error)) as HttpException;
}

describe('AuthService', () => {
  const users = {
    create: vi.fn(),
    delete: vi.fn(),
    deleteExpiredUnverified: vi.fn(),
    consumeTwoFactorStep: vi.fn(),
    findByVerificationTokenHash: vi.fn(),
    findForLogin: vi.fn(),
    findForTwoFactor: vi.fn(),
    findUnverifiedByEmail: vi.fn(),
    markEmailVerified: vi.fn(),
    recordTwoFactorFailure: vi.fn(),
    setVerificationToken: vi.fn(),
  };
  const passwords = { hash: vi.fn(), verify: vi.fn() };
  const jwt = new JwtService({
    secret: JWT_SECRET,
    signOptions: { expiresIn: 3600 },
  });
  const mail = { sendEmailVerification: vi.fn() };
  const totp = { verify: vi.fn() };
  const challenges = new TwoFactorChallengeService(jwt, {
    get: () => JWT_SECRET,
  } as unknown as ConfigService);
  let auth: AuthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    passwords.hash.mockResolvedValue('$argon2id$hash');
    users.create.mockResolvedValue(ALICE);
    mail.sendEmailVerification.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: PasswordService, useValue: passwords },
        { provide: MailClient, useValue: mail },
        { provide: JwtService, useValue: jwt },
        { provide: TotpService, useValue: totp },
        { provide: TwoFactorChallengeService, useValue: challenges },
        {
          provide: SessionService,
          useValue: {
            issue: async (user: typeof ALICE) => ({
              accessToken: await jwt.signAsync({
                sub: user.id,
                username: user.username,
              }),
              user: { id: user.id, username: user.username, elo: user.elo },
            }),
          },
        },
      ],
    }).compile();

    auth = moduleRef.get(AuthService);
  });

  /** Token emailed to the user by the last register/resend call. */
  function sentToken(): string {
    const call = mail.sendEmailVerification.mock.calls.at(-1) as string[];
    return call[2];
  }

  describe('register', () => {
    it('creates an unverified account holding only the token hash', async () => {
      await auth.register(DTO);

      const input = users.create.mock.calls[0][0];
      expect(input).toMatchObject({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$argon2id$hash',
        emailVerificationTokenHash: hashVerificationToken(sentToken()),
      });
      expect(input).not.toHaveProperty('emailVerifiedAt');
      const ttl = input.emailVerificationExpiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(29 * MINUTE);
      expect(ttl).toBeLessThanOrEqual(30 * MINUTE);
    });

    it('frees names held by expired unverified accounts first', async () => {
      await auth.register(DTO);

      const cleanupOrder =
        users.deleteExpiredUnverified.mock.invocationCallOrder[0];
      expect(cleanupOrder).toBeLessThan(
        users.create.mock.invocationCallOrder[0],
      );
    });

    it('emails the token and returns only the public user fields', async () => {
      await expect(auth.register(DTO)).resolves.toEqual({
        user: { id: 'uuid', username: 'alice', elo: 1200 },
      });
      expect(mail.sendEmailVerification).toHaveBeenCalledWith(
        'alice@example.com',
        'alice',
        expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      );
    });

    it('deletes the account and answers 503 when the email cannot be sent', async () => {
      mail.sendEmailVerification.mockRejectedValue(new MailUnavailableError());

      const error = await caught(auth.register(DTO));

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.getResponse()).toMatchObject({
        code: 'EMAIL_SERVICE_UNAVAILABLE',
      });
      expect(users.delete).toHaveBeenCalledWith('uuid');
    });

    it.each([
      ['username', 'USERNAME_ALREADY_EXISTS'],
      ['email', 'EMAIL_ALREADY_EXISTS'],
    ] as const)('maps a duplicate %s to 409 %s', async (field, code) => {
      users.create.mockRejectedValue(new DuplicateUserFieldError(field));

      const error = await caught(auth.register(DTO));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ statusCode: 409, code });
      expect(mail.sendEmailVerification).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('verifies the account of a valid token', async () => {
      users.findByVerificationTokenHash.mockResolvedValue({
        ...ALICE,
        emailVerificationExpiresAt: new Date(Date.now() + MINUTE),
      });

      await expect(auth.verifyEmail('the-token')).resolves.toEqual({
        user: { id: 'uuid', username: 'alice', elo: 1200 },
      });
      expect(users.findByVerificationTokenHash).toHaveBeenCalledWith(
        hashVerificationToken('the-token'),
      );
      expect(users.markEmailVerified).toHaveBeenCalledWith('uuid');
    });

    it('rejects an unknown or already used token', async () => {
      users.findByVerificationTokenHash.mockResolvedValue(null);

      const error = await caught(auth.verifyEmail('the-token'));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({
        code: 'INVALID_VERIFICATION_TOKEN',
      });
    });

    it('deletes the account when the token has expired', async () => {
      users.findByVerificationTokenHash.mockResolvedValue({
        ...ALICE,
        emailVerificationExpiresAt: new Date(Date.now() - MINUTE),
      });

      const error = await caught(auth.verifyEmail('the-token'));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(users.delete).toHaveBeenCalledWith('uuid');
      expect(users.markEmailVerified).not.toHaveBeenCalled();
    });
  });

  describe('resendVerification', () => {
    it('replaces the token and emails the new one', async () => {
      users.findUnverifiedByEmail.mockResolvedValue(ALICE);

      await auth.resendVerification('alice@example.com');

      const [id, tokenHash, expiresAt] =
        users.setVerificationToken.mock.calls[0];
      expect(id).toBe('uuid');
      expect(tokenHash).toBe(hashVerificationToken(sentToken()));
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * MINUTE);
    });

    it('does nothing, silently, for an unknown or verified email', async () => {
      users.findUnverifiedByEmail.mockResolvedValue(null);

      await expect(
        auth.resendVerification('nobody@example.com'),
      ).resolves.toBeUndefined();
      expect(mail.sendEmailVerification).not.toHaveBeenCalled();
    });

    it('answers 503 when the email cannot be sent', async () => {
      users.findUnverifiedByEmail.mockResolvedValue(ALICE);
      mail.sendEmailVerification.mockRejectedValue(new MailUnavailableError());

      await expect(
        auth.resendVerification('alice@example.com'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('login', () => {
    const CREDENTIALS = { login: 'alice', password: 'correct-horse' };
    const VERIFIED = {
      ...ALICE,
      passwordHash: '$argon2id$stored',
      emailVerifiedAt: new Date(),
    };

    it('returns a signed access token and the public user fields', async () => {
      users.findForLogin.mockResolvedValue(VERIFIED);
      passwords.verify.mockResolvedValue(true);

      const response = await auth.login(CREDENTIALS);

      expect(response.user).toEqual({
        id: 'uuid',
        username: 'alice',
        elo: 1200,
      });
      const claims = await jwt.verifyAsync(response.accessToken);
      expect(claims).toMatchObject({ sub: 'uuid', username: 'alice' });
      expect(claims.exp - claims.iat).toBe(3600);
      expect(users.findForLogin).toHaveBeenCalledWith('alice');
      expect(passwords.verify).toHaveBeenCalledWith(
        '$argon2id$stored',
        'correct-horse',
      );
    });

    it('rejects a wrong password with 401', async () => {
      users.findForLogin.mockResolvedValue(VERIFIED);
      passwords.verify.mockResolvedValue(false);

      const error = await caught(auth.login(CREDENTIALS));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.getResponse()).toMatchObject({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
    });

    it.each([
      ['an unknown login', null],
      [
        'an account without password (OAuth)',
        { ...VERIFIED, passwordHash: null },
      ],
    ])(
      'answers %s like a wrong password, after hashing work',
      async (_, user) => {
        users.findForLogin.mockResolvedValue(user);
        passwords.verify.mockResolvedValue(false);

        const error = await caught(auth.login(CREDENTIALS));

        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.getResponse()).toMatchObject({
          code: 'INVALID_CREDENTIALS',
        });
        expect(passwords.verify).toHaveBeenCalledWith(
          '$argon2id$hash',
          'correct-horse',
        );
      },
    );

    it('computes the timing dummy hash only once', async () => {
      users.findForLogin.mockResolvedValue(null);
      passwords.verify.mockResolvedValue(false);

      await caught(auth.login(CREDENTIALS));
      await caught(auth.login(CREDENTIALS));

      expect(passwords.hash).toHaveBeenCalledTimes(1);
    });

    it('rejects an unverified account with 403, only with the right password', async () => {
      users.findForLogin.mockResolvedValue({
        ...VERIFIED,
        emailVerifiedAt: null,
      });
      passwords.verify.mockResolvedValue(true);

      const error = await caught(auth.login(CREDENTIALS));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toMatchObject({
        statusCode: 403,
        code: 'EMAIL_NOT_VERIFIED',
      });

      passwords.verify.mockResolvedValue(false);
      await expect(auth.login(CREDENTIALS)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('two-factor login', () => {
    const CREDENTIALS = { login: 'alice', password: 'correct-horse' };
    const TWO_FACTOR_USER = {
      ...ALICE,
      passwordHash: '$argon2id$stored',
      emailVerifiedAt: new Date(),
      twoFactorEnabledAt: new Date(),
      twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      twoFactorLastTimeStep: 41,
      twoFactorLockedUntil: null,
    };

    async function challenge(): Promise<string> {
      users.findForLogin.mockResolvedValue(TWO_FACTOR_USER);
      passwords.verify.mockResolvedValue(true);
      const response = await auth.login(CREDENTIALS);
      return (response as { challengeToken: string }).challengeToken;
    }

    beforeEach(() => {
      users.findForTwoFactor.mockResolvedValue(TWO_FACTOR_USER);
      users.consumeTwoFactorStep.mockResolvedValue(true);
      totp.verify.mockResolvedValue(42);
    });

    it('answers a challenge instead of an access token', async () => {
      users.findForLogin.mockResolvedValue(TWO_FACTOR_USER);
      passwords.verify.mockResolvedValue(true);

      const response = await auth.login(CREDENTIALS);

      expect(response).toEqual({
        requires2fa: true,
        challengeToken: expect.any(String),
      });
      expect(response).not.toHaveProperty('accessToken');
    });

    it('does not let a challenge pass as an access token', async () => {
      const token = await challenge();

      await expect(jwt.verifyAsync(token)).rejects.toThrow();
    });

    it('trades the challenge and a valid code for an access token', async () => {
      const response = await auth.verifyTwoFactor({
        challengeToken: await challenge(),
        code: '123456',
      });

      expect(response.user).toEqual({
        id: 'uuid',
        username: 'alice',
        elo: 1200,
      });
      await expect(
        jwt.verifyAsync(response.accessToken),
      ).resolves.toMatchObject({
        sub: 'uuid',
      });
      expect(users.findForTwoFactor).toHaveBeenCalledWith('uuid');
      expect(totp.verify).toHaveBeenCalledWith(
        'JBSWY3DPEHPK3PXP',
        '123456',
        41,
      );
      expect(users.consumeTwoFactorStep).toHaveBeenCalledWith('uuid', 42);
    });

    it.each([
      ['a forged token', () => Promise.resolve('not.a.token')],
      [
        'an access token',
        () => jwt.signAsync({ sub: 'uuid', username: 'alice' }),
      ],
    ])('rejects %s as challenge with 401', async (_, token) => {
      const error = await caught(
        auth.verifyTwoFactor({ challengeToken: await token(), code: '123456' }),
      );

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.getResponse()).toMatchObject({
        code: 'INVALID_2FA_CHALLENGE',
      });
      expect(totp.verify).not.toHaveBeenCalled();
    });

    it('rejects the challenge once 2FA has been turned off', async () => {
      const challengeToken = await challenge();
      users.findForTwoFactor.mockResolvedValue({
        ...TWO_FACTOR_USER,
        twoFactorEnabledAt: null,
      });

      const error = await caught(
        auth.verifyTwoFactor({ challengeToken, code: '123456' }),
      );

      expect(error.getResponse()).toMatchObject({
        code: 'INVALID_2FA_CHALLENGE',
      });
    });

    it('counts a wrong code and answers 401', async () => {
      totp.verify.mockResolvedValue(null);

      const error = await caught(
        auth.verifyTwoFactor({
          challengeToken: await challenge(),
          code: '000000',
        }),
      );

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.getResponse()).toMatchObject({ code: 'INVALID_2FA_CODE' });
      const [id, max, lockUntil] = users.recordTwoFactorFailure.mock.calls[0];
      expect([id, max]).toEqual(['uuid', TWO_FACTOR_MAX_ATTEMPTS]);
      expect(lockUntil.getTime() - Date.now()).toBeGreaterThan(
        TWO_FACTOR_LOCK_MS - MINUTE,
      );
      expect(users.consumeTwoFactorStep).not.toHaveBeenCalled();
    });

    it('answers 429 without checking the code while locked', async () => {
      const challengeToken = await challenge();
      users.findForTwoFactor.mockResolvedValue({
        ...TWO_FACTOR_USER,
        twoFactorLockedUntil: new Date(Date.now() + MINUTE),
      });

      const error = await caught(
        auth.verifyTwoFactor({ challengeToken, code: '123456' }),
      );

      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(error.getResponse()).toMatchObject({
        code: 'TOO_MANY_2FA_ATTEMPTS',
      });
      expect(totp.verify).not.toHaveBeenCalled();
    });

    it('rejects a code another request has just used', async () => {
      users.consumeTwoFactorStep.mockResolvedValue(false);

      const error = await caught(
        auth.verifyTwoFactor({
          challengeToken: await challenge(),
          code: '123456',
        }),
      );

      expect(error.getResponse()).toMatchObject({ code: 'INVALID_2FA_CODE' });
    });
  });
});
