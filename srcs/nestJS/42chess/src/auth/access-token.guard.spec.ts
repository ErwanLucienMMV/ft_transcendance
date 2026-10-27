import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthGuard } from './auth.guard.js';
import { SessionService } from './session.service.js';
import type { Repository } from 'typeorm';
import type { AuthSession } from './auth-session.entity.js';
import type { User } from '../users/user.entity.js';

const secret = 'unit-test-jwt-secret-of-32-chars!';
describe('AccessTokenGuard', () => {
  const jwt = new JwtService({ secret });
  const sub = randomUUID();
  const user = {
    id: sub,
    username: 'alice',
    elo: 1200,
    emailVerifiedAt: new Date(),
  } as User;
  const rows = { insert: vi.fn(), findOneBy: vi.fn() };
  const users = { findOneBy: vi.fn() };
  const sessions = new SessionService(
    new JwtService({
      secret,
      signOptions: { algorithm: 'HS256', expiresIn: 60 },
    }),
    rows as unknown as Repository<AuthSession>,
    users as unknown as Repository<User>,
    { getOrThrow: () => 604800 } as unknown as ConfigService,
  );
  const guard = new AccessTokenGuard(new AuthGuard(sessions));
  beforeEach(() => {
    vi.resetAllMocks();
    users.findOneBy.mockResolvedValue(user);
    rows.insert.mockImplementation(async (row: AuthSession) => {
      rows.findOneBy.mockResolvedValue(row);
    });
  });
  function context(authorization?: string) {
    const request = {
      headers: { authorization },
      user: undefined as { id: string } | undefined,
    };
    return {
      request,
      execution: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext,
    };
  }

  it('binds the user and live session of a verified access token', async () => {
    const { accessToken: token } = await sessions.issue(user);
    const c = context(`Bearer ${token}`);
    expect(await guard.canActivate(c.execution)).toBe(true);
    expect(c.request.user).toEqual(user);
  });

  it.each([undefined, 'Bearer forged', 'Basic credentials'])(
    'rejects invalid authorization %s',
    async (header) => {
      await expect(
        guard.canActivate(context(header).execution),
      ).rejects.toMatchObject({ status: 401 });
    },
  );

  it.each([
    { sub, username: 'alice', exp: 1 },
    { sub, username: 'alice' },
    { sub: 'not-a-uuid', username: 'alice', exp: 9999999999 },
    { sub, username: 'alice', typ: '2fa-challenge', exp: 9999999999 },
    { sub, exp: 9999999999 },
  ])('rejects expired or foreign token claims %j', async (claims) => {
    const token = await jwt.signAsync(claims);
    await expect(
      guard.canActivate(context(`Bearer ${token}`).execution),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a token signed with another secret', async () => {
    const token = await jwt.signAsync(
      { sub, username: 'alice', jti: randomUUID(), typ: 'access' },
      { secret: 'another-secret', expiresIn: 60 },
    );
    await expect(
      guard.canActivate(context(`Bearer ${token}`).execution),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a signed token whose session has been revoked or removed', async () => {
    const { accessToken } = await sessions.issue(user);
    rows.findOneBy.mockResolvedValue(null);
    await expect(
      guard.canActivate(context(`Bearer ${accessToken}`).execution),
    ).rejects.toMatchObject({
      response: { code: 'AUTH_REQUIRED' },
      status: 401,
    });
  });

  it('does not bind a principal after its user is deleted', async () => {
    const { accessToken } = await sessions.issue(user);
    users.findOneBy.mockResolvedValue(null);
    const c = context(`Bearer ${accessToken}`);
    await expect(guard.canActivate(c.execution)).rejects.toMatchObject({
      status: 401,
    });
    expect(c.request.user).toBeUndefined();
  });
});
