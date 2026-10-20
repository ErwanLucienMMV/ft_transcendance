import { publicProfile } from './user-profile.js';

describe('SCRUM-101 public-profile privacy boundary', () => {
  const publicData = {
    id: 'user-id',
    username: 'alice',
    avatarUrl: null,
    elo: 1200,
    gamesPlayed: 12,
  };
  it('never reads private properties even when the source contains account secrets', () => {
    const source = new Proxy(
      {
        ...publicData,
        email: 'private@example.com',
        passwordHash: 'private-hash',
        emailVerificationTokenHash: 'private-token',
        twoFactorSecret: 'private-totp',
        lastSeenAt: new Date(),
        preferences: { language: 'fr', theme: 'dark', soundEnabled: false },
        futurePrivateField: 'private-future-value',
      },
      {
        get(target, property, receiver) {
          if (!Object.hasOwn(publicData, property))
            throw new Error(`Private access: ${String(property)}`);
          return Reflect.get(target, property, receiver);
        },
      },
    );
    expect(publicProfile(source, false)).toEqual({
      ...publicData,
      online: false,
    });
  });
  it('includes only the public allowlist for online and offline accounts', () => {
    for (const online of [true, false]) {
      const result = publicProfile(
        { ...publicData, avatarUrl: 'https://example.com/avatar.png', elo: 0 },
        online,
      );
      expect(result).toEqual({
        ...publicData,
        avatarUrl: 'https://example.com/avatar.png',
        elo: 0,
        online,
      });
      expect(Object.keys(result)).toEqual([
        'id',
        'username',
        'avatarUrl',
        'elo',
        'gamesPlayed',
        'online',
      ]);
    }
  });
});
