import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { Repository } from 'typeorm';
import { REFRESH_TOKEN, SessionService } from './session.service.js';
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
    { getOrThrow: () => 604800 } as unknown as ConfigService,
  );
  beforeEach(() => {
    vi.resetAllMocks();
    users.findOneBy.mockResolvedValue(user);
  });
  it('issues unique sessions and stores only a hash of the refresh secret', async () => {
    const a = await service.issue(user),
      b = await service.issue(user);
    const ca = jwt.decode(a.accessToken),
      cb = jwt.decode(b.accessToken);
    expect(ca.jti).not.toBe(cb.jti);
    expect(ca).toMatchObject({ sub: user.id, typ: 'access' });
    const refresh = a[REFRESH_TOKEN]!;
    expect(refresh.startsWith(`${ca.jti}.`)).toBe(true);
    const row = rows.insert.mock.calls[0][0];
    expect(row).toMatchObject({
      id: ca.jti,
      userId: user.id,
      revokedAt: null,
      previousRefreshTokenHash: null,
    });
    expect(row.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(refresh.split('.')[1]);
    // The session outlives the access token: that is what the refresh cookie renews.
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(6 * 86400000);
    expect(a.user).toEqual({ id: user.id, username: 'alice', elo: 1200 });
    expect(JSON.stringify(a)).not.toContain(refresh);
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
    users.findOneBy.mockResolvedValue({
      id: user.id,
      username: user.username,
      elo: user.elo,
      emailVerifiedAt: null,
    });
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

  describe('refresh cookie', () => {
    async function issued() {
      const response = await service.issue(user);
      const row = {
        ...rows.insert.mock.calls.at(-1)![0],
        refreshRotatedAt: null,
      };
      rows.findOneBy.mockResolvedValue(row);
      return { token: response[REFRESH_TOKEN]!, row };
    }

    it('renews the access token, rotates the secret and slides the session', async () => {
      const { token, row } = await issued();
      rows.update.mockResolvedValue({ affected: 1 });
      const renewed = await service.refresh(token);
      expect(jwt.decode(renewed.accessToken)).toMatchObject({
        sub: user.id,
        jti: row.id,
        typ: 'access',
      });
      const next = renewed[REFRESH_TOKEN]!;
      expect(next).not.toBe(token);
      expect(next.startsWith(`${row.id}.`)).toBe(true);
      expect(rows.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: row.id,
          refreshTokenHash: row.refreshTokenHash,
        }),
        expect.objectContaining({
          previousRefreshTokenHash: row.refreshTokenHash,
          refreshRotatedAt: expect.any(Date),
          expiresAt: expect.any(Date),
        }),
      );
    });

    it('lets a concurrent tab reuse the previous secret briefly, without a new cookie', async () => {
      const { token, row } = await issued();
      rows.findOneBy.mockResolvedValue({
        ...row,
        refreshTokenHash: 'f'.repeat(64),
        previousRefreshTokenHash: row.refreshTokenHash,
        refreshRotatedAt: new Date(),
      });
      const renewed = await service.refresh(token);
      expect(renewed.accessToken).toBeTruthy();
      expect(renewed[REFRESH_TOKEN]).toBeUndefined();
      expect(rows.update).not.toHaveBeenCalled();
    });

    it('revokes the session when an old secret is replayed after the grace period', async () => {
      const { token, row } = await issued();
      rows.findOneBy.mockResolvedValue({
        ...row,
        refreshTokenHash: 'f'.repeat(64),
        previousRefreshTokenHash: row.refreshTokenHash,
        refreshRotatedAt: new Date(Date.now() - 60_000),
      });
      await expect(service.refresh(token)).rejects.toMatchObject({
        status: 401,
      });
      expect(rows.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: row.id, userId: user.id }),
        { revokedAt: expect.any(Date) },
      );
    });

    it('refuses unknown, malformed, expired, revoked and unverified sessions', async () => {
      const { token, row } = await issued();
      for (const bad of [
        '',
        'garbage',
        `${row.id}.short`,
        token.slice(0, -1) + 'x',
      ])
        await expect(service.refresh(bad)).rejects.toMatchObject({
          status: 401,
        });
      rows.findOneBy.mockResolvedValue(null);
      await expect(service.refresh(token)).rejects.toMatchObject({
        status: 401,
      });
      rows.findOneBy.mockResolvedValue({
        ...row,
        expiresAt: new Date(Date.now() - 1),
      });
      await expect(service.refresh(token)).rejects.toMatchObject({
        status: 401,
      });
      rows.findOneBy.mockResolvedValue(row);
      users.findOneBy.mockResolvedValue({
        id: user.id,
        username: user.username,
        elo: user.elo,
        emailVerifiedAt: null,
      });
      await expect(service.refresh(token)).rejects.toMatchObject({
        status: 401,
      });
    });

    it('revokes from the cookie alone, only when the secret matches', async () => {
      const { token, row } = await issued();
      await expect(
        service.revokeRefresh(`${row.id}.${'A'.repeat(43)}`),
      ).resolves.toBe(false);
      await expect(service.revokeRefresh('nonsense')).resolves.toBe(false);
      expect(rows.update).not.toHaveBeenCalled();
      await expect(service.revokeRefresh(token)).resolves.toBe(true);
      expect(rows.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: row.id, userId: user.id }),
        { revokedAt: expect.any(Date) },
      );
    });
  });
});
