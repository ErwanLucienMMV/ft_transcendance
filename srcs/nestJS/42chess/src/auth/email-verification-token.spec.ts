import {
  EMAIL_VERIFICATION_TTL_MS,
  generateVerificationToken,
  hashVerificationToken,
  verificationExpiry,
} from './email-verification-token.js';

describe('email verification token', () => {
  it('is URL-safe, 43 characters long and different every time', () => {
    const first = generateVerificationToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateVerificationToken()).not.toBe(first);
  });

  it('is stored as a stable SHA-256 hash, never as is', () => {
    const token = generateVerificationToken();

    expect(hashVerificationToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashVerificationToken(token)).toBe(hashVerificationToken(token));
    expect(hashVerificationToken(token)).not.toContain(token);
  });

  it('expires after 30 minutes', () => {
    const now = new Date('2026-10-11T12:00:00Z');

    expect(verificationExpiry(now).getTime() - now.getTime()).toBe(
      EMAIL_VERIFICATION_TTL_MS,
    );
    expect(EMAIL_VERIFICATION_TTL_MS).toBe(30 * 60 * 1000);
  });
});
