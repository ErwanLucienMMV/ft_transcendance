import type { User } from './user.entity.js';

export function publicProfile(
  user: Pick<User, 'id' | 'username' | 'avatarUrl' | 'elo' | 'gamesPlayed'>,
  online: boolean,
) {
  return {
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    elo: user.elo,
    gamesPlayed: user.gamesPlayed,
    online,
  };
}

/** Explicit API projection; never serialize an account entity. Spec §4. */
export function ownProfile(user: User) {
  return {
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    elo: user.elo,
    gamesPlayed: user.gamesPlayed,
    gamesWon: user.gamesWon,
    gamesDraw: user.gamesDraw,
    gamesLost: user.gamesLost,
    createdAt: user.createdAt.toISOString(),
  };
}
