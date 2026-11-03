import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';

/** What one player is about to do to another. */
export type ContactKind = 'message' | 'challenge' | 'friend-request';

const VERBS: Record<ContactKind, string> = {
  message: 'send messages to',
  challenge: 'challenge',
  'friend-request': 'send a friend request to',
};

/**
 * Who may reach whom. A block, in either direction, stops messages, challenges and friend
 * requests; a player who chose "friends only" receives messages and challenges from
 * friends alone.
 */
@Injectable()
export class ContactRules {
  constructor(private readonly source: DataSource) {}

  async check(
    actorId: string,
    targetId: string,
    kind: ContactKind,
    manager: EntityManager = this.source.manager,
  ): Promise<void> {
    const [row] = (await manager.query(
      `SELECT
         EXISTS (SELECT 1 FROM user_blocks WHERE "blockerId" = $1 AND "blockedId" = $2) AS "blocking",
         EXISTS (SELECT 1 FROM user_blocks WHERE "blockerId" = $2 AND "blockedId" = $1) AS "blockedBy",
         COALESCE((SELECT (preferences->>'messagesFromFriendsOnly')::boolean FROM users WHERE id = $2), false) AS "friendsOnly",
         EXISTS (SELECT 1 FROM friendships WHERE "userId" = LEAST($1::uuid, $2::uuid) AND "friendId" = GREATEST($1::uuid, $2::uuid)) AS "friends"`,
      [actorId, targetId],
    )) as {
      blocking: boolean;
      blockedBy: boolean;
      friendsOnly: boolean;
      friends: boolean;
    }[];
    if (row.blocking)
      throw new ForbiddenException({
        statusCode: 403,
        code: 'USER_BLOCKED',
        message: `You blocked this player. Unblock them to ${VERBS[kind]} them.`,
      });
    if (row.blockedBy)
      throw new ForbiddenException({
        statusCode: 403,
        code: 'USER_BLOCKED',
        message: `You cannot ${VERBS[kind]} this player.`,
      });
    if (kind !== 'friend-request' && row.friendsOnly && !row.friends)
      throw new ForbiddenException({
        statusCode: 403,
        code: 'FRIENDS_ONLY',
        message: `This player only lets friends ${VERBS[kind]} them.`,
      });
  }
}
