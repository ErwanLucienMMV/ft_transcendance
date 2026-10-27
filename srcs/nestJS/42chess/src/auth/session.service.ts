import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { User } from '../users/user.entity.js';
import { AuthSession } from './auth-session.entity.js';

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
  ) {}

  async issue(
    user: User,
  ): Promise<{
    accessToken: string;
    user: { id: string; username: string; elo: number };
  }> {
    const id = randomUUID();
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      jti: id,
      typ: 'access',
    });
    const claims = this.jwt.decode<Claims>(accessToken);
    await this.sessions.insert({
      id,
      userId: user.id,
      expiresAt: new Date(claims.exp * 1000),
      revokedAt: null,
    });
    return {
      accessToken,
      user: { id: user.id, username: user.username, elo: user.elo },
    };
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

  async revoke(sessionId: string, userId: string): Promise<void> {
    await this.sessions.update(
      { id: sessionId, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }
}
