import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  CHALLENGE_TTL_SECONDS,
  TwoFactorChallengeService,
} from './two-factor-challenge.service.js';

const JWT_SECRET = 'unit-test-jwt-secret-of-32-chars!';

describe('TwoFactorChallengeService', () => {
  const jwt = new JwtService({ secret: JWT_SECRET });
  const challenges = new TwoFactorChallengeService(jwt, {
    get: () => JWT_SECRET,
  } as unknown as ConfigService);

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads back the user id of a challenge it issued', async () => {
    await expect(challenges.read(await challenges.issue('uuid'))).resolves.toBe(
      'uuid',
    );
  });

  it('is not signed with JWT_SECRET itself', async () => {
    await expect(
      jwt.verifyAsync(await challenges.issue('uuid')),
    ).rejects.toThrow();
  });

  it('refuses a token signed with JWT_SECRET, even with the right type', async () => {
    const token = await jwt.signAsync({ sub: 'uuid', typ: '2fa-challenge' });

    await expect(challenges.read(token)).resolves.toBeNull();
  });

  it('expires after five minutes', async () => {
    vi.useFakeTimers();
    const token = await challenges.issue('uuid');

    vi.advanceTimersByTime((CHALLENGE_TTL_SECONDS + 1) * 1000);

    await expect(challenges.read(token)).resolves.toBeNull();
  });
});
