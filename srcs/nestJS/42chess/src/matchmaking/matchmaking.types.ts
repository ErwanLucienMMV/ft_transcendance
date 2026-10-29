import type { UUID } from '../common/types/api.js';
import type { TimeControl } from '../games/clock/game-clock.js';
import type { MatchmakingEntry as StoredEntry } from './matchmaking-queue.entity.js';

export interface JoinMatchmakingResponse {
  status: 'WAITING';
  joinedAt: Date;
}

/** Spec §24. Requeue resets status/createdAt on the user's single persisted entry. */
export interface MatchmakingEntry {
  id: UUID;
  userId: UUID;
  timeControl: TimeControl;
  elo: number;
  joinedAt: Date;
  status: 'WAITING' | 'MATCHED' | 'CANCELLED';
}
export function toMatchmakingEntry(row: StoredEntry): MatchmakingEntry {
  return {
    id: row.id,
    userId: row.userId,
    timeControl: row.timeControl,
    elo: row.elo,
    joinedAt: row.joinedAt,
    status: row.status,
  };
}
