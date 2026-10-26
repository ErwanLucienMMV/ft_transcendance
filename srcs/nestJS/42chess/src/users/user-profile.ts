import type { User } from './user.entity.js';

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
