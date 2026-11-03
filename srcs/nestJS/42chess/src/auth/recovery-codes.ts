import { createHash, randomInt } from 'node:crypto';

/** Codes given when 2FA is turned on, each usable once instead of an authenticator code. */
export const RECOVERY_CODE_COUNT = 10;
// No 0/o, 1/l/i: a code is copied by hand from paper.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Ten characters, shown as two groups of five ("ab3de-fg5hj"); about 49 bits each. */
export const RECOVERY_CODE = /^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): {
  codes: string[];
  hashes: string[];
} {
  const codes = Array.from({ length: count }, () => {
    const chars = Array.from(
      { length: 10 },
      () => ALPHABET[randomInt(ALPHABET.length)],
    ).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/** Case and the hyphen do not matter when a code is typed back. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256')
    .update(code.replace(/-/g, '').toLowerCase())
    .digest('hex');
}
