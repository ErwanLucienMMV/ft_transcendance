import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isUUID } from 'class-validator';
import { User } from '../users/user.entity.js';
import type { TimeControl } from '../games/clock/game-clock.js';
import { MatchmakingEntry } from './matchmaking-queue.entity.js';
import type { JoinMatchmakingResponse } from './matchmaking.types.js';

@Injectable()
export class MatchmakingService {
  constructor(private readonly source: DataSource) {}

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
      const [clock]: { now: Date }[] = await manager.query(
        'SELECT clock_timestamp() AS now',
      );
      // A user's single durable row is reused after MATCHED/CANCELLED, with a fresh FIFO age.
      const entry = manager.create(MatchmakingEntry, {
        ...(existing ? { id: existing.id } : {}),
        userId: user.id,
        rating: user.elo,
        initialTime: timeControl.initialTime,
        increment: timeControl.increment,
        status: 'WAITING',
        createdAt: clock.now,
      });
      await manager.save(entry);
      return { status: 'WAITING', joinedAt: entry.createdAt };
    });
  }
}
