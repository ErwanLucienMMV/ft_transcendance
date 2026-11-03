import type { User } from '../users/user.entity.js';

/** Public part of a user returned by the auth endpoints, enough to draw the header. */
export interface AuthUser {
  id: string;
  username: string;
  elo: number;
  /** `avatars/<file>` for an upload (relative to the API), an https URL, or null. */
  avatarUrl: string | null;
}

export function authUser(
  user: Pick<User, 'id' | 'username' | 'elo' | 'avatarUrl'>,
): AuthUser {
  return {
    id: user.id,
    username: user.username,
    elo: user.elo,
    avatarUrl: user.avatarUrl ?? null,
  };
}
