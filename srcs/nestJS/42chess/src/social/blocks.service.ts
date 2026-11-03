import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserEvents } from './user-events.js';

export interface BlockedUser {
  id: string;
  username: string;
  avatarUrl: string | null;
  blockedAt: string;
}

/**
 * Blocking ends what links two players: their friendship, pending friend requests and
 * open challenges. It is silent: the blocked player is not told, but can no longer
 * message, challenge or befriend the blocker (see ContactRules).
 */
@Injectable()
export class BlocksService {
  constructor(
    private readonly source: DataSource,
    private readonly events: UserEvents,
  ) {}

  async list(actorId: string): Promise<{ users: BlockedUser[] }> {
    const rows = (await this.source.query(
      `SELECT u.id, u.username, u."avatarUrl", b."createdAt" AS "blockedAt"
       FROM user_blocks b JOIN users u ON u.id = b."blockedId"
       WHERE b."blockerId" = $1 ORDER BY lower(u.username), u.id`,
      [actorId],
    )) as (Omit<BlockedUser, 'blockedAt'> & { blockedAt: Date })[];
    return {
      users: rows.map((row) => ({
        id: row.id,
        username: row.username,
        avatarUrl: row.avatarUrl,
        blockedAt: row.blockedAt.toISOString(),
      })),
    };
  }

  async block(actorId: string, targetId: string): Promise<void> {
    if (actorId === targetId)
      throw new BadRequestException({
        statusCode: 400,
        code: 'BLOCK_SELF',
        message: 'You cannot block yourself.',
      });
    const ended = await this.source.transaction(async (manager) => {
      const [first, second] = [actorId, targetId].sort();
      // Open challenges between them can no longer be played. They are locked
      // first, in the order a join takes its locks (game, then accounts): a join
      // already running ends before the block, and its started game is left alone.
      const challenges = (await manager.query(
        `SELECT g.id FROM games g WHERE g.status = 'WAITING' AND EXISTS (
           SELECT 1 FROM game_players p WHERE p."gameId" = g.id
             AND ((p."userId" = $1 AND g."invitedOpponentId" = $2)
               OR (p."userId" = $2 AND g."invitedOpponentId" = $1)))
         ORDER BY g.id FOR UPDATE OF g`,
        [actorId, targetId],
      )) as { id: string }[];
      // Same lock order as friend requests, so blocking cannot race a new friendship.
      const users = (await manager.query(
        `SELECT id FROM users WHERE id IN ($1, $2) AND "emailVerifiedAt" IS NOT NULL
         ORDER BY id FOR UPDATE`,
        [first, second],
      )) as { id: string }[];
      if (!users.some((user) => user.id === targetId))
        throw new NotFoundException({
          statusCode: 404,
          code: 'USER_NOT_FOUND',
          message: 'User not found.',
        });
      await manager.query(
        `INSERT INTO user_blocks ("blockerId", "blockedId") VALUES ($1, $2)
         ON CONFLICT ON CONSTRAINT "UQ_user_blocks_pair" DO NOTHING`,
        [actorId, targetId],
      );
      const [, friendships] = (await manager.query(
        `DELETE FROM friendships WHERE "userId" = $1 AND "friendId" = $2`,
        [first, second],
      )) as [unknown, number];
      const requests = (await manager.query(
        `DELETE FROM friend_requests WHERE status = 'PENDING'
         AND (("senderId" = $1 AND "recipientId" = $2) OR ("senderId" = $2 AND "recipientId" = $1))
         RETURNING id`,
        [actorId, targetId],
      )) as [{ id: string }[], number];
      // The creator's waiting room hears that the game is gone at its next refresh.
      const ids = challenges.map((game) => game.id);
      if (ids.length > 0) {
        await manager.query(
          `DELETE FROM game_messages WHERE "gameId" = ANY($1::uuid[])`,
          [ids],
        );
        await manager.query(`DELETE FROM games WHERE id = ANY($1::uuid[])`, [
          ids,
        ]);
      }
      return { friends: friendships > 0, requests: requests[0] };
    });
    if (ended.friends) {
      await this.events.send([actorId], 'FRIEND_REMOVED', { userId: targetId });
      await this.events.send([targetId], 'FRIEND_REMOVED', { userId: actorId });
    }
    for (const { id } of ended.requests)
      await this.events.send([actorId, targetId], 'FRIEND_REQUEST_REMOVED', {
        requestId: id,
      });
  }

  async unblock(actorId: string, targetId: string): Promise<void> {
    await this.source.query(
      `DELETE FROM user_blocks WHERE "blockerId" = $1 AND "blockedId" = $2`,
      [actorId, targetId],
    );
  }
}
