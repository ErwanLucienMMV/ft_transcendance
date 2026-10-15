import { createHash, randomBytes } from 'node:crypto';

/** How long a verification link stays valid. */
export const EMAIL_VERIFICATION_TTL_MS = 30 * 60 * 1000;

/** 32 random bytes, URL-safe (43 characters): sent by email, never stored. */
export function generateVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Only this hash is stored. SHA-256 is enough (unlike passwords): the token is
 * random and long, so it cannot be guessed from its hash.
 */
export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function verificationExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS);
}
