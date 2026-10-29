import type { User } from '../users/user.entity.js';
import type { GamePlayer } from './game-player.entity.js';
import type { PlayerRef } from './game-api.types.js';

/** Public view of a seat loaded with its user; a bot seat has no account and no rating. */
export function playerRef(seat: GamePlayer & { user: User | null }): PlayerRef {
  if (seat.user)
    return {
      id: seat.user.id,
      username: seat.user.username,
      avatarUrl: seat.user.avatarUrl,
      elo: seat.user.elo,
      color: seat.color,
    };
  return {
    id: seat.id,
    username: `Bot ${seat.botDifficulty}`,
    avatarUrl: null,
    elo: null,
    color: seat.color,
    botDifficulty: seat.botDifficulty!,
  };
}
