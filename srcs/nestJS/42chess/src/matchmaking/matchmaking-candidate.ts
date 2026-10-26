import type { EntityManager } from 'typeorm';
import { MatchmakingEntry } from './matchmaking-queue.entity.js';
import { ELO_WINDOW, eloWindow } from './matchmaking.policy.js';

/**
 * Reserve the oldest compatible opponent until the caller's transaction ends.
 * The caller must already hold the seeker's queue lock and pass its current
 * snapshot. Matching must recheck eligibility before creating the game.
 *
 * Only queue rows are locked. In particular, locking users here would invert
 * join's user -> queue order and allow a join/matcher deadlock. Eligibility is
 * checked against this statement's snapshot; a concurrent account/game change
 * is therefore the matching transaction's responsibility to revalidate.
 */
export async function findCompatible(
  manager: EntityManager,
  seeker: MatchmakingEntry,
  now: Date,
): Promise<MatchmakingEntry | null> {
  if (!manager.queryRunner?.isTransactionActive) {
    throw new Error('Candidate selection requires an active transaction.');
  }
  const window = eloWindow(seeker.createdAt, now);
  if (seeker.status !== 'WAITING') return null;

  // Match Date's millisecond precision even when PostgreSQL stored microseconds.
  const candidateWindow = `LEAST(:maximumWindow, :initialWindow + :windowStep *
    FLOOR(GREATEST(0, EXTRACT(EPOCH FROM
      (CAST(:now AS timestamptz) - date_trunc('milliseconds', candidate."createdAt"))) * 1000)
      / :windowInterval))`;
  const eligible = (userId: string) => `
    EXISTS (SELECT 1 FROM users u WHERE u.id = ${userId}
      AND u."emailVerifiedAt" IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM game_players p JOIN games g ON g.id = p."gameId"
      WHERE p."userId" = ${userId} AND g.status = 'ACTIVE'
    )`;

  return manager
    .createQueryBuilder(MatchmakingEntry, 'candidate')
    .where('candidate.status = :waiting', { waiting: 'WAITING' })
    .andWhere('candidate.id != :seekerId', { seekerId: seeker.id })
    .andWhere('candidate."userId" != :seekerUserId', {
      seekerUserId: seeker.userId,
    })
    .andWhere('candidate."initialTime" = :initialTime', {
      initialTime: seeker.initialTime,
    })
    .andWhere('candidate.increment = :increment', {
      increment: seeker.increment,
    })
    // Indexable bounded search; each player's tolerance must accept the gap.
    .andWhere('candidate.rating BETWEEN :minimumRating AND :maximumRating', {
      minimumRating: Math.max(0, seeker.rating - window),
      maximumRating: Math.min(2147483647, seeker.rating + window),
    })
    .andWhere(
      `ABS(candidate.rating::bigint - CAST(:seekerRating AS bigint)) <= ${candidateWindow}`,
      {
        seekerRating: seeker.rating,
        now,
        maximumWindow: ELO_WINDOW.maximum,
        initialWindow: ELO_WINDOW.initial,
        windowStep: ELO_WINDOW.step,
        windowInterval: ELO_WINDOW.intervalMs,
      },
    )
    .andWhere(eligible('candidate."userId"'))
    .andWhere(eligible(':seekerUserId'))
    .orderBy('candidate."createdAt"', 'ASC')
    .addOrderBy('candidate.id', 'ASC')
    .take(1)
    .setLock('pessimistic_write', undefined, ['candidate'])
    .setOnLocked('skip_locked')
    .getOne();
}
