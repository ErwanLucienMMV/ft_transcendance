import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard.js';

const secret = 'unit-test-jwt-secret-of-32-chars!';
describe('AccessTokenGuard', () => {
  const jwt = new JwtService({ secret });
  const guard = new AccessTokenGuard(jwt);
  const sub = randomUUID();
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

  it('binds only the subject of a verified access token', async () => {
    const token = await jwt.signAsync(
      { sub, username: 'alice' },
      { expiresIn: 60 },
    );
    const c = context(`Bearer ${token}`);
    expect(await guard.canActivate(c.execution)).toBe(true);
    expect(c.request.user).toEqual({ id: sub });
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
      { sub, username: 'alice' },
      { secret: 'another-secret', expiresIn: 60 },
    );
    await expect(
      guard.canActivate(context(`Bearer ${token}`).execution),
    ).rejects.toMatchObject({ status: 401 });
  });
});
