import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { DEFAULT_REFRESH_EXPIRES_IN } from '../config/environment.js';
import { User } from '../users/user.entity.js';
import { AuthSession } from './auth-session.entity.js';

/**
 * Carries the refresh cookie value next to a token response. A symbol key is never
 * serialized, so the secret cannot leak into a JSON body; RefreshCookieInterceptor
 * moves it into the httpOnly cookie.
 */
export const REFRESH_TOKEN = Symbol('refreshToken');
export interface IssuedSession {
  accessToken: string;
  user: { id: string; username: string; elo: number };
  [REFRESH_TOKEN]?: string;
}
// A second tab may still send the cookie it read just before another tab rotated it.
const ROTATION_GRACE_MS = 30_000;

export interface SessionPrincipal {
  user: User;
  sessionId: string;
  expiresAt: number;
}
interface Claims {
  sub: string;
  jti: string;
  typ: string;
  exp: number;
}

function digest(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function same(hash: string | null, candidate: string): boolean {
  return !!hash && timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

export function invalidRefreshToken(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'INVALID_REFRESH_TOKEN',
    message: 'The session can no longer be renewed. Please sign in again.',
  });
}

export function invalidAccessToken(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'INVALID_TOKEN',
    message: 'Authentication is required or the session has expired.',
  });
}

@Injectable()
export class SessionService {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Session lifetime in milliseconds, also the refresh cookie Max-Age. The application
   * validates the setting; test modules with a partial configuration get the same default.
   */
  lifetime(): number {
    return (
      (this.config.get<number>('REFRESH_EXPIRES_IN') ??
        DEFAULT_REFRESH_EXPIRES_IN) * 1000
    );
  }

  async issue(user: User): Promise<IssuedSession> {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    await this.sessions.insert({
      id,
      userId: user.id,
      expiresAt: new Date(Date.now() + this.lifetime()),
      revokedAt: null,
      refreshTokenHash: digest(secret),
      previousRefreshTokenHash: null,
      refreshRotatedAt: null,
    });
    return this.respond(user, id, secret);
  }

  /**
   * Trades the refresh cookie for a new access token and rotates the cookie. Its
   * previous value stays usable for a few seconds without rotating again, so tabs
   * restoring at the same time do not sign each other out; replaying it later means
   * it was stolen, and the whole session is revoked.
   */
  async refresh(token: string): Promise<IssuedSession> {
    const parsed = this.parseRefresh(token);
    if (!parsed) throw invalidRefreshToken();
    const session = await this.sessions.findOneBy({
      id: parsed.id,
      revokedAt: IsNull(),
    });
    if (!session || session.expiresAt.getTime() <= Date.now())
      throw invalidRefreshToken();
    const user = await this.users.findOneBy({ id: session.userId });
    if (!user?.emailVerifiedAt) throw invalidRefreshToken();
    const hash = digest(parsed.secret);
    if (same(session.refreshTokenHash, hash)) {
      const secret = randomBytes(32).toString('base64url');
      const rotated = await this.sessions.update(
        { id: session.id, refreshTokenHash: hash, revokedAt: IsNull() },
        {
          refreshTokenHash: digest(secret),
          previousRefreshTokenHash: hash,
          refreshRotatedAt: new Date(),
          expiresAt: new Date(Date.now() + this.lifetime()),
        },
      );
      // Another request rotated this value first: answer like the grace path.
      return this.respond(user, session.id, rotated.affected ? secret : null);
    }
    if (same(session.previousRefreshTokenHash, hash)) {
      const rotatedAt = session.refreshRotatedAt?.getTime() ?? 0;
      if (Date.now() - rotatedAt <= ROTATION_GRACE_MS)
        return this.respond(user, session.id, null);
      await this.revoke(session.id, session.userId);
    }
    throw invalidRefreshToken();
  }

  /** Logout without a usable access token: the refresh cookie identifies the session. */
  async revokeRefresh(token: string): Promise<boolean> {
    const parsed = this.parseRefresh(token);
    if (!parsed) return false;
    const session = await this.sessions.findOneBy({ id: parsed.id });
    const hash = digest(parsed.secret);
    if (
      !session ||
      !(
        same(session.refreshTokenHash, hash) ||
        same(session.previousRefreshTokenHash, hash)
      )
    )
      return false;
    await this.revoke(session.id, session.userId);
    return true;
  }

  async authenticate(token: string): Promise<SessionPrincipal> {
    let claims: Claims;
    try {
      if (!token || token.length > 8192) throw invalidAccessToken();
      claims = await this.jwt.verifyAsync<Claims>(token, {
        algorithms: ['HS256'],
      });
      if (
        claims.typ !== 'access' ||
        !isUUID(claims.sub) ||
        !isUUID(claims.jti) ||
        !Number.isFinite(claims.exp)
      )
        throw invalidAccessToken();
    } catch {
      throw invalidAccessToken();
    }
    const session = await this.sessions.findOneBy({
      id: claims.jti,
      userId: claims.sub,
      revokedAt: IsNull(),
    });
    if (!session || session.expiresAt.getTime() <= Date.now())
      throw invalidAccessToken();
    const user = await this.users.findOneBy({ id: claims.sub });
    if (!user?.emailVerifiedAt) throw invalidAccessToken();
    return {
      user,
      sessionId: session.id,
      expiresAt: Math.min(claims.exp * 1000, session.expiresAt.getTime()),
    };
  }

  private async respond(
    user: User,
    sessionId: string,
    secret: string | null,
  ): Promise<IssuedSession> {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      jti: sessionId,
      typ: 'access',
    });
    const response: IssuedSession = {
      accessToken,
      user: { id: user.id, username: user.username, elo: user.elo },
    };
    if (secret) response[REFRESH_TOKEN] = `${sessionId}.${secret}`;
    return response;
  }

  private parseRefresh(token: string): { id: string; secret: string } | null {
    const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token ?? '');
    return match && isUUID(match[1])
      ? { id: match[1], secret: match[2] }
      : null;
  }

  async revoke(sessionId: string, userId: string): Promise<void> {
    await this.sessions.update(
      { id: sessionId, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }
}
