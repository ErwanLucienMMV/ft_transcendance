import type { MatchmakingEntry } from './matchmaking-queue.entity.js';

/** Server-owned queue snapshot; rating is copied from User.elo at join time. */
export type MatchmakingCandidate = Readonly<
  Pick<
    MatchmakingEntry,
    | 'id'
    | 'userId'
    | 'rating'
    | 'initialTime'
    | 'increment'
    | 'status'
    | 'createdAt'
  >
>;

export const ELO_WINDOW = Object.freeze({
  initial: 100,
  step: 50,
  intervalMs: 30_000,
  maximum: 400,
});

function timestamp(date: Date): number {
  const value = date.getTime();
  if (!Number.isFinite(value)) {
    throw new RangeError('Matchmaking requires valid server timestamps.');
  }
  return value;
}

/** Inclusive Elo tolerance; future queue dates have zero wait age. */
export function eloWindow(createdAt: Date, now: Date): number {
  const waitMs = Math.max(0, timestamp(now) - timestamp(createdAt));
  return Math.min(
    ELO_WINDOW.maximum,
    ELO_WINDOW.initial +
      Math.floor(waitMs / ELO_WINDOW.intervalMs) * ELO_WINDOW.step,
  );
}

/** Both players must accept the gap: an old entry cannot widen a new one's window. */
export function areCompatible(
  left: MatchmakingCandidate,
  right: MatchmakingCandidate,
  now: Date,
): boolean {
  if (
    left.id === right.id ||
    left.userId === right.userId ||
    left.status !== 'WAITING' ||
    right.status !== 'WAITING' ||
    left.initialTime !== right.initialTime ||
    left.increment !== right.increment
  ) {
    return false;
  }
  return (
    Math.abs(left.rating - right.rating) <=
    Math.min(eloWindow(left.createdAt, now), eloWindow(right.createdAt, now))
  );
}

/** Sort eligible candidates oldest first, then by canonical UUID for stable ties. */
export function compareQueueOrder(
  left: MatchmakingCandidate,
  right: MatchmakingCandidate,
): number {
  const ageOrder = timestamp(left.createdAt) - timestamp(right.createdAt);
  if (ageOrder !== 0) return ageOrder;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
