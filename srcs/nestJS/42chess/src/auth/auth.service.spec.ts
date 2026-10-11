import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MailClient, MailUnavailableError } from '../mail/mail.client.js';
import {
  DuplicateUserFieldError,
  UsersService,
} from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { hashVerificationToken } from './email-verification-token.js';
import { PasswordService } from './password.service.js';

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

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  return (await promise.catch((error: unknown) => error)) as HttpException;
}

describe('AuthService', () => {
  const users = {
    create: vi.fn(),
    delete: vi.fn(),
    deleteExpiredUnverified: vi.fn(),
    findByVerificationTokenHash: vi.fn(),
    findUnverifiedByEmail: vi.fn(),
    markEmailVerified: vi.fn(),
    setVerificationToken: vi.fn(),
  };
  const passwords = { hash: vi.fn() };
  const mail = { sendEmailVerification: vi.fn() };
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
});
