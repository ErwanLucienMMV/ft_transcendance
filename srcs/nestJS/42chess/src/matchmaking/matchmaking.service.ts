import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { isUUID } from 'class-validator';
import { User } from '../users/user.entity.js';
import type { TimeControl } from '../games/clock/game-clock.js';
import { MatchmakingEntry } from './matchmaking-queue.entity.js';
import { MATCH_CHANNEL } from './matchmaking-events.service.js';
import type { QueueStatus } from './matchmaking.types.js';
import type { JoinMatchmakingResponse } from './matchmaking.types.js';
import { GamesService } from '../games/games.service.js';
import { findCompatible } from './matchmaking-candidate.js';
import { MATCHMAKING_LEASE_MS } from './matchmaking-lease.js';

@Injectable()
export class MatchmakingService {
  constructor(
    private readonly source: DataSource,
    @Optional() private readonly games?: GamesService,
  ) {}

  private async serialize(manager: EntityManager): Promise<void> {
    // All queue mutators share this lock BEFORE user/queue locks. It also serializes
    // matching across replicas without inverting join's user -> queue lock order.
    await manager.query('SELECT pg_advisory_xact_lock(42004, 1)');
  }

  private async now(manager: EntityManager): Promise<Date> {
    const [clock]: { now: Date }[] = await manager.query(
      'SELECT clock_timestamp() AS now',
    );
    return clock.now;
  }

  private async expire(manager: EntityManager, userId?: string): Promise<void> {
    const update = manager
      .createQueryBuilder()
      .update(MatchmakingEntry)
      .set({ status: 'CANCELLED' })
      .where('status = :status', { status: 'WAITING' })
      .andWhere('"leaseExpiresAt" <= clock_timestamp()');
    if (userId) update.andWhere('"userId" = :userId', { userId });
    await update.execute();
  }

  async status(userId: string): Promise<QueueStatus> {
    const id = this.actor(userId);
    return this.source.transaction(async (manager) => {
      await this.serialize(manager);
      await this.expire(manager, id);
      return this.queueStatus(manager, id);
    });
  }

  /** Only explicit search heartbeats renew a live lease, never an expired one. */
  async heartbeat(userId: string): Promise<QueueStatus> {
    const id = this.actor(userId);
    return this.source.transaction(async (manager) => {
      await this.serialize(manager);
      // Compare and renew in SQL to retain PostgreSQL's sub-millisecond precision.
      await manager
        .createQueryBuilder()
        .update(MatchmakingEntry)
        .set({
          leaseExpiresAt: () =>
            "clock_timestamp() + (:leaseMs * interval '1 millisecond')",
        })
        .where('"userId" = :id AND status = :status', { id, status: 'WAITING' })
        .andWhere('"leaseExpiresAt" > clock_timestamp()')
        .setParameter('leaseMs', MATCHMAKING_LEASE_MS)
        .execute();
      await this.expire(manager, id);
      return this.queueStatus(manager, id);
    });
  }

  async leave(userId: string): Promise<QueueStatus> {
    const id = this.actor(userId);
    return this.source.transaction(async (manager) => {
      await this.serialize(manager);
      await manager.update(
        MatchmakingEntry,
        { userId: id, status: 'WAITING' },
        { status: 'CANCELLED' },
      );
      return this.queueStatus(manager, id);
    });
  }

  private actor(userId: string): string {
    if (!isUUID(userId))
      throw new BadRequestException('A valid actor is required.');
    return userId.toLowerCase();
  }

  private async queueStatus(
    manager: EntityManager,
    userId: string,
  ): Promise<QueueStatus> {
    const entry = await manager.findOneBy(MatchmakingEntry, { userId });
    if (!entry) return { status: 'IDLE' };
    if (entry.status === 'MATCHED')
      return {
        status: 'MATCHED',
        ...(entry.matchedGameId ? { gameId: entry.matchedGameId } : {}),
      };
    return { status: entry.status, joinedAt: entry.createdAt };
  }

  /** One database transaction owns selection, clocks, seats, queue state and event. */
  async matchNext(): Promise<string | null> {
    if (!this.games) throw new Error('GamesService is required for matching.');
    return this.source.transaction(async (manager) => {
      await this.serialize(manager);
      // Expiration and selection share the cross-replica queue mutation lock.
      await this.expire(manager);
      const waiting = await manager.find(MatchmakingEntry, {
        where: { status: 'WAITING' },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      for (const observed of waiting) {
        const seeker = await manager.findOne(MatchmakingEntry, {
          where: { id: observed.id, status: 'WAITING' },
          lock: { mode: 'pessimistic_write' },
        });
        if (!seeker) continue;
        // A long scan must not keep using the time sampled before the scan.
        const opponent = await this.findCompatible(
          manager,
          seeker,
          await this.now(manager),
        );
        if (!opponent) continue;
        // Selection may take time. Recheck both reserved leases with the full DB
        // timestamp immediately before creating a game, while still holding the lock.
        const live: { id: string }[] = await manager.query(
          `SELECT id FROM matchmaking_queue WHERE id = ANY($1::uuid[])
           AND status = 'WAITING' AND "leaseExpiresAt" > clock_timestamp()`,
          [[seeker.id, opponent.id]],
        );
        if (live.length !== 2) {
          await this.expire(manager);
          continue;
        }
        const state = await this.games!.createMatched(
          manager,
          seeker.userId,
          opponent.userId,
          seeker.timeControl,
        );
        await manager.update(MatchmakingEntry, [seeker.id, opponent.id], {
          status: 'MATCHED',
          matchedGameId: state.game.id,
          matchedAt: new Date(state.game.startedAt!),
        });
        await manager.query(
          `INSERT INTO matchmaking_matches
          ("gameId", "matchedAt", "whiteWaitSeconds", "blackWaitSeconds")
          VALUES ($1, $2, GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - $3::timestamptz))),
                           GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - $4::timestamptz))))`,
          [
            state.game.id,
            state.game.startedAt,
            seeker.createdAt,
            opponent.createdAt,
          ],
        );
        // PostgreSQL emits NOTIFY only after COMMIT, to listeners on every replica.
        await manager.query('SELECT pg_notify($1, $2)', [
          MATCH_CHANNEL,
          JSON.stringify({
            gameId: state.game.id,
            whiteId: seeker.userId,
            blackId: opponent.userId,
          }),
        ]);
        return state.game.id;
      }
      return null;
    });
  }

  findCompatible(
    manager: EntityManager,
    seeker: MatchmakingEntry,
    now: Date,
  ): Promise<MatchmakingEntry | null> {
    return findCompatible(manager, seeker, now);
  }

  async join(
    userId: string,
    timeControl: TimeControl,
  ): Promise<JoinMatchmakingResponse> {
    if (
      !isUUID(userId) ||
      !timeControl ||
      !Number.isInteger(timeControl.initialTime) ||
      timeControl.initialTime < 1 ||
      timeControl.initialTime > 2147483647 ||
      !Number.isInteger(timeControl.increment) ||
      timeControl.increment < 0 ||
      timeControl.increment > 2147483647
    ) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_MATCHMAKING_INPUT',
        message:
          'A valid actor and integer time control in milliseconds are required.',
      });
    }
    return this.source.transaction(async (manager) => {
      await this.serialize(manager);
      // Lock the user even when no queue row exists: concurrent first joins are serialized.
      // Queue mutators must lock this row before replacing it; matching must lock queue rows.
      const user = await manager.findOne(User, {
        where: { id: userId.toLowerCase() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user)
        throw new NotFoundException({
          statusCode: 404,
          code: 'USER_NOT_FOUND',
          message: 'User does not exist.',
        });
      // A matcher can finish while we wait on its queue lock. Check active games
      // only after that wait, so a just-MATCHED row cannot immediately be requeued.
      await this.expire(manager, user.id);
      const existing = await manager.findOne(MatchmakingEntry, {
        where: { userId: user.id },
        lock: { mode: 'pessimistic_write' },
      });
      const active: { id: string }[] = await manager.query(
        `SELECT g.id FROM games g JOIN game_players p ON p."gameId" = g.id WHERE p."userId" = $1 AND g.status = 'ACTIVE' LIMIT 1`,
        [user.id],
      );
      if (active.length)
        throw new ConflictException({
          statusCode: 409,
          code: 'ACTIVE_GAME_EXISTS',
          message: 'Finish your active game before joining matchmaking.',
        });
      if (existing?.status === 'WAITING')
        throw new ConflictException({
          statusCode: 409,
          code: 'ALREADY_IN_QUEUE',
          message: 'You are already waiting in the matchmaking queue.',
        });
      const now = await this.now(manager);
      // Reuse the durable row after MATCHED/CANCELLED/expiry, with a fresh FIFO age.
      const entry = manager.create(MatchmakingEntry, {
        ...(existing ? { id: existing.id } : {}),
        userId: user.id,
        rating: user.elo,
        initialTime: timeControl.initialTime,
        increment: timeControl.increment,
        status: 'WAITING',
        matchedGameId: null,
        matchedAt: null,
        createdAt: now,
        leaseExpiresAt: new Date(now.getTime() + MATCHMAKING_LEASE_MS),
      });
      await manager.save(entry);
      return { status: 'WAITING', joinedAt: entry.createdAt };
    });
  }
}
