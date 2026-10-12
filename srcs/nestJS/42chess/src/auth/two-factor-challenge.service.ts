import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Environment } from '../config/environment.js';

/** Time left to type the code once the password has been accepted. */
export const CHALLENGE_TTL_SECONDS = 5 * 60;

const CHALLENGE_TYPE = '2fa-challenge';

interface ChallengePayload {
  sub: string;
  typ: typeof CHALLENGE_TYPE;
}

/**
 * Short-lived proof that a user passed the password step of a 2FA login.
 *
 * Signed with a key derived from JWT_SECRET instead of JWT_SECRET itself, so
 * a challenge can never be accepted where an access token is expected, and
 * an access token can never stand in for a challenge.
 */
@Injectable()
export class TwoFactorChallengeService {
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Environment, true>,
  ) {
    this.secret = createHmac(
      'sha256',
      config.get('JWT_SECRET', { infer: true }),
    )
      .update(CHALLENGE_TYPE)
      .digest('base64url');
  }

  issue(userId: string): Promise<string> {
    const payload: ChallengePayload = { sub: userId, typ: CHALLENGE_TYPE };
    return this.jwt.signAsync(payload, {
      secret: this.secret,
      expiresIn: CHALLENGE_TTL_SECONDS,
    });
  }

  /** Returns the user id, or null for a forged, expired or foreign token. */
  async read(token: string): Promise<string | null> {
    try {
      const payload = await this.jwt.verifyAsync<ChallengePayload>(token, {
        secret: this.secret,
        algorithms: ['HS256'],
      });
      return payload.typ === CHALLENGE_TYPE ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
