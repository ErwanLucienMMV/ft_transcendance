import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import { SessionService } from './session.service.js';
import type { AuthSession } from './auth-session.entity.js';
import type { User } from '../users/user.entity.js';

describe('Revocable access sessions', () => {
  const jwt = new JwtService({
    secret: 'session-tests-secret-at-least-32-characters',
    signOptions: { algorithm: 'HS256', expiresIn: 3600 },
  });
  const user = {
    id: randomUUID(),
    username: 'alice',
    elo: 1200,
    emailVerifiedAt: new Date(),
  } as User;
  const rows = { insert: vi.fn(), findOneBy: vi.fn(), update: vi.fn() };
  const users = { findOneBy: vi.fn() };
  const service = new SessionService(
    jwt,
    rows as unknown as Repository<AuthSession>,
    users as unknown as Repository<User>,
  );
  beforeEach(() => {
    vi.resetAllMocks();
    users.findOneBy.mockResolvedValue(user);
  });
  it('issues unique session identifiers and persists only the identifier and expiry', async () => {
    const a = await service.issue(user),
      b = await service.issue(user);
    const ca = jwt.decode(a.accessToken),
      cb = jwt.decode(b.accessToken);
    expect(ca.jti).not.toBe(cb.jti);
    expect(ca).toMatchObject({ sub: user.id, typ: 'access' });
    expect(rows.insert).toHaveBeenCalledWith({
      id: ca.jti,
      userId: user.id,
      revokedAt: null,
      expiresAt: new Date(ca.exp * 1000),
    });
    expect(a.user).toEqual({ id: user.id, username: 'alice', elo: 1200 });
  });
  it('requires a live database session and verified user, not merely a valid signature', async () => {
    const { accessToken } = await service.issue(user);
    rows.findOneBy.mockResolvedValue(null);
    await expect(service.authenticate(accessToken)).rejects.toMatchObject({
      status: 401,
    });
    rows.findOneBy.mockResolvedValue(rows.insert.mock.calls[0][0]);
    await expect(service.authenticate(accessToken)).resolves.toMatchObject({
      user,
      sessionId: jwt.decode(accessToken).jti,
    });
    users.findOneBy.mockResolvedValue({ ...user, emailVerifiedAt: null });
    await expect(service.authenticate(accessToken)).rejects.toMatchObject({
      status: 401,
    });
  });
  it.each(['garbage', '', 'a.b.c'])(
    'rejects a malformed token: %s',
    async (token) => {
      await expect(service.authenticate(token)).rejects.toMatchObject({
        status: 401,
      });
      expect(rows.findOneBy).not.toHaveBeenCalled();
    },
  );
  it('rejects expired, foreign and legacy tokens', async () => {
    for (const token of [
      await jwt.signAsync({ sub: user.id }),
      await jwt.signAsync({
        sub: user.id,
        jti: randomUUID(),
        typ: '2fa-challenge',
      }),
      await jwt.signAsync(
        { sub: user.id, jti: randomUUID(), typ: 'access' },
        { expiresIn: -1 },
      ),
      await jwt.signAsync(
        { sub: user.id, jti: randomUUID(), typ: 'access' },
        { secret: 'other' },
      ),
    ])
      await expect(service.authenticate(token)).rejects.toMatchObject({
        status: 401,
      });
    expect(rows.findOneBy).not.toHaveBeenCalled();
  });
  it('revokes only the current user/session pair', async () => {
    const id = randomUUID();
    await service.revoke(id, user.id);
    expect(rows.update).toHaveBeenCalledWith(
      expect.objectContaining({ id, userId: user.id }),
      { revokedAt: expect.any(Date) },
    );
  });
});
