import { ThrottlerModule } from '@nestjs/throttler';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';

const MINUTE = 60_000;

/** Every route: high enough for normal play, low enough to stop a flood. */
export const DEFAULT_RATE_LIMIT = { ttl: MINUTE, limit: 600 };

/** Sign-in steps, where a password or a code can be guessed. */
export const AUTH_RATE_LIMIT = { default: { ttl: MINUTE, limit: 20 } };

/** Routes that send an email to an existing account. */
export const EMAIL_RATE_LIMIT = { default: { ttl: 10 * MINUTE, limit: 5 } };

/**
 * Registration also sends an email, but a room behind one address (an
 * evaluation, a campus) must still be able to open several accounts.
 */
export const REGISTER_RATE_LIMIT = {
  default: { ttl: 10 * MINUTE, limit: 20 },
};

/**
 * RATE_LIMIT_ENABLED=false turns the limits off (browser and HTTP test
 * stacks create many accounts from one address). They are on by default,
 * except under the unit test runner.
 */
export function rateLimitEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env['RATE_LIMIT_ENABLED']?.trim().toLowerCase();
  if (!value) return !env['VITEST'];
  return !['false', '0', 'no', 'off'].includes(value);
}

export const rateLimitOptions: ThrottlerModuleOptions = {
  throttlers: [{ name: 'default', ...DEFAULT_RATE_LIMIT }],
  skipIf: () => !rateLimitEnabled(),
};

export const RateLimitModule = ThrottlerModule.forRoot(rateLimitOptions);
