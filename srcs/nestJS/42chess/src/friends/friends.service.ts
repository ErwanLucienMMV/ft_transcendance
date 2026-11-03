import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PresenceService } from '../presence/presence.service.js';
import { ContactRules } from '../social/contact-rules.js';
import { UserEvents } from '../social/user-events.js';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import type { UUID } from '../common/types/api.js';
import { Friendship } from './friendships.entity.js';
import { FriendRequest } from './friend-requests.entity.js';
import { User } from '../users/user.entity.js';
import {
  toFriend,
  toFriendRequest,
  type FriendRequestResponse,
  type FriendRequestsResponse,
  type FriendsResponse,
} from './friends.types.js';

/** After a decline, the same player waits this long before asking again. */
export const DECLINED_REQUEST_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

/** Public fields of the other player, sent with friend events. */
const PUBLIC_USER = {
  id: true,
  username: true,
  avatarUrl: true,
  elo: true,
  lastSeenAt: true,
} as const;

/** Accepted relationships live only in friendships; pending requests are separate. */
@Injectable()
export class FriendsService {
  constructor(
    @InjectRepository(Friendship)
    private readonly friendships: Repository<Friendship>,
    private readonly presence: PresenceService,
    private readonly contacts: ContactRules,
    private readonly events: UserEvents,
  ) {}

  /**
   * Sends a request, or accepts the other player's pending one when they already asked:
   * the answer then has status ACCEPTED.
   */
  async sendRequest(
    actorId: UUID,
    recipientId: UUID,
  ): Promise<FriendRequestResponse> {
    const result = await this.send(actorId, recipientId);
    if (result.status === 'ACCEPTED') await this.announceFriendship(result);
    else await this.announceRequest(result);
    return result;
  }

  private async send(
    actorId: UUID,
    recipientId: UUID,
  ): Promise<FriendRequestResponse> {
    actorId = actorId.toLowerCase();
    recipientId = recipientId.toLowerCase();
    if (actorId === recipientId)
      throw new BadRequestException({
        statusCode: 400,
        code: 'FRIEND_REQUEST_SELF',
        message: 'You cannot send yourself a friend request.',
      });

    return this.friendships.manager.transaction(async (manager) => {
      const [userId, friendId] = [actorId, recipientId].sort();
      // Every mutation of this pair must lock the same accounts in UUID order.
      // Besides duplicate sends, this coordinates accept/remove with new sends.
      const users = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .where('user.id IN (:...ids)', { ids: [userId, friendId] })
        .orderBy('user.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      const actor = users.find((user) => user.id === actorId);
      if (!actor)
        throw new UnauthorizedException({
          statusCode: 401,
          code: 'AUTH_REQUIRED',
          message: 'A valid account is required.',
        });
      if (!actor.emailVerifiedAt)
        throw new ForbiddenException({
          statusCode: 403,
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Verify your email before continuing.',
        });
      const recipient = users.find((user) => user.id === recipientId);
      if (!recipient?.emailVerifiedAt)
        throw new NotFoundException({
          statusCode: 404,
          code: 'USER_NOT_FOUND',
          message: 'Recipient not found.',
        });
      await this.contacts.check(
        actorId,
        recipientId,
        'friend-request',
        manager,
      );
      if (await manager.existsBy(Friendship, { userId, friendId }))
        throw new ConflictException({
          statusCode: 409,
          code: 'ALREADY_FRIENDS',
          message: 'You are already friends.',
        });
      const requests = manager.getRepository(FriendRequest);
      // They already asked: both want it, so this is a yes.
      const crossed = await requests.findOneBy({
        senderId: recipientId,
        recipientId: actorId,
        status: 'PENDING',
      });
      if (crossed) {
        crossed.status = 'ACCEPTED';
        crossed.resolvedAt = new Date();
        await requests.save(crossed);
        await manager.getRepository(Friendship).save({ userId, friendId });
        return toFriendRequest(crossed);
      }
      if (
        await manager.existsBy(FriendRequest, {
          senderId: actorId,
          recipientId,
          status: 'PENDING',
        })
      )
        throw new ConflictException({
          statusCode: 409,
          code: 'FRIEND_REQUEST_PENDING',
          message: 'A pending friend request already exists.',
        });
      // Only the pair's latest answer counts: a decline followed by a friendship (in
      // either direction) no longer holds the player back.
      const latest = await requests.findOne({
        where: [
          { senderId: actorId, recipientId, status: Not('PENDING') },
          {
            senderId: recipientId,
            recipientId: actorId,
            status: Not('PENDING'),
          },
        ],
        order: { resolvedAt: { direction: 'DESC', nulls: 'LAST' } },
      });
      if (
        latest?.status === 'REJECTED' &&
        latest.senderId === actorId &&
        latest.resolvedAt &&
        Date.now() - latest.resolvedAt.getTime() < DECLINED_REQUEST_COOLDOWN_MS
      )
        throw new ConflictException({
          statusCode: 409,
          code: 'FRIEND_REQUEST_DECLINED_RECENTLY',
          message:
            'This player declined your request recently. You can ask again in a few days.',
        });
      return toFriendRequest(
        await requests.save(
          requests.create({
            senderId: actorId,
            recipientId,
            status: 'PENDING',
          }),
        ),
      );
    });
  }

  async acceptRequest(
    actorId: UUID,
    requestId: UUID,
  ): Promise<FriendRequestResponse> {
    const accepted = await this.resolveRequest(actorId, requestId, 'ACCEPTED');
    await this.announceFriendship(accepted);
    return accepted;
  }

  async rejectRequest(
    actorId: UUID,
    requestId: UUID,
  ): Promise<FriendRequestResponse> {
    const declined = await this.resolveRequest(actorId, requestId, 'REJECTED');
    await this.events.send(
      [declined.senderId, declined.recipientId],
      'FRIEND_REQUEST_REMOVED',
      { requestId: declined.id },
    );
    return declined;
  }

  /**
   * `DELETE /friends/requests/:id`: the recipient declines it, the sender withdraws it. A
   * withdrawn request leaves no trace, so it can be sent again at once.
   */
  async removeRequest(actorId: UUID, requestId: UUID): Promise<void> {
    actorId = actorId.toLowerCase();
    const request = await this.friendships.manager
      .getRepository(FriendRequest)
      .findOneBy({ id: requestId });
    if (request?.recipientId === actorId) {
      await this.rejectRequest(actorId, requestId);
      return;
    }
    const deleted = (await this.friendships.manager.query(
      `DELETE FROM friend_requests WHERE id = $1 AND "senderId" = $2 AND status = 'PENDING'
       RETURNING "recipientId"`,
      [requestId, actorId],
    )) as [{ recipientId: string }[], number];
    if (!deleted[0].length)
      throw new NotFoundException({
        statusCode: 404,
        code: 'FRIEND_REQUEST_NOT_FOUND',
        message: 'Friend request not found.',
      });
    await this.events.send(
      [actorId, deleted[0][0].recipientId],
      'FRIEND_REQUEST_REMOVED',
      { requestId },
    );
  }

  /** Pending requests the signed-in user sent, oldest first. */
  async sentRequests(actorId: UUID): Promise<FriendRequestsResponse> {
    const requests = await this.friendships.manager
      .getRepository(FriendRequest)
      .find({
        where: { senderId: actorId, status: 'PENDING' },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    return { requests: requests.map(toFriendRequest) };
  }

  /** The recipient learns of it at once, with who sent it. */
  private async announceRequest(request: FriendRequestResponse): Promise<void> {
    const sender = await this.friendships.manager
      .getRepository(User)
      .findOne({ where: { id: request.senderId }, select: PUBLIC_USER });
    if (sender)
      await this.events.send([request.recipientId], 'FRIEND_REQUEST_RECEIVED', {
        request,
        sender: toFriend(sender),
      });
    await this.events.send([request.senderId], 'FRIEND_REQUEST_SENT', {
      request,
    });
  }

  /** Each side gets the other as a new friend, with live presence. */
  private async announceFriendship(
    request: FriendRequestResponse,
  ): Promise<void> {
    const users = await this.friendships.manager.getRepository(User).find({
      where: [{ id: request.senderId }, { id: request.recipientId }],
      select: PUBLIC_USER,
    });
    for (const user of users) {
      const other = users.find((candidate) => candidate.id !== user.id);
      if (!other) continue;
      await this.events.send([user.id], 'FRIEND_ADDED', {
        requestId: request.id,
        friend: {
          ...toFriend(other),
          status: this.presence.get(other.id).status,
        },
      });
    }
  }

  private async resolveRequest(
    actorId: UUID,
    requestId: UUID,
    status: 'ACCEPTED' | 'REJECTED',
  ): Promise<FriendRequestResponse> {
    actorId = actorId.toLowerCase();
    return this.friendships.manager.transaction(async (manager) => {
      const requests = manager.getRepository(FriendRequest);
      const initial = await requests.findOneBy({ id: requestId });
      if (!initial)
        throw new NotFoundException({
          statusCode: 404,
          code: 'FRIEND_REQUEST_NOT_FOUND',
          message: 'Friend request not found.',
        });

      const [userId, friendId] = [initial.senderId, initial.recipientId].sort();
      // Match sendRequest's lock order before locking/re-reading the request.
      const users = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .where('user.id IN (:...ids)', { ids: [userId, friendId] })
        .orderBy('user.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      const pending = await requests.findOne({
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!pending)
        throw new NotFoundException({
          statusCode: 404,
          code: 'FRIEND_REQUEST_NOT_FOUND',
          message: 'Friend request not found.',
        });
      if (pending.recipientId !== actorId)
        throw new ForbiddenException({
          statusCode: 403,
          code: 'FRIEND_REQUEST_FORBIDDEN',
          message: 'Only the recipient can resolve this request.',
        });
      const actor = users.find((user) => user.id === actorId);
      if (!actor?.emailVerifiedAt)
        throw new ForbiddenException({
          statusCode: 403,
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Verify your email before continuing.',
        });
      if (pending.status !== 'PENDING')
        throw new ConflictException({
          statusCode: 409,
          code: 'FRIEND_REQUEST_FINALIZED',
          message: 'This friend request has already been resolved.',
        });
      if (
        status === 'ACCEPTED' &&
        (await manager.existsBy(Friendship, { userId, friendId }))
      )
        throw new ConflictException({
          statusCode: 409,
          code: 'ALREADY_FRIENDS',
          message: 'You are already friends.',
        });

      pending.status = status;
      pending.resolvedAt = new Date();
      await requests.save(pending);
      if (status === 'ACCEPTED')
        await manager.getRepository(Friendship).save({ userId, friendId });
      return toFriendRequest(pending);
    });
  }

  async receivedRequests(actorId: UUID): Promise<FriendRequestsResponse> {
    const requests = await this.friendships.manager
      .getRepository(FriendRequest)
      .find({
        where: { recipientId: actorId, status: 'PENDING' },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    return { requests: requests.map(toFriendRequest) };
  }

  async removeFriend(actorId: UUID, otherId: UUID): Promise<void> {
    actorId = actorId.toLowerCase();
    otherId = otherId.toLowerCase();
    await this.friendships.manager.transaction(async (manager) => {
      const [userId, friendId] = [actorId, otherId].sort();
      // Same pair lock as send/resolve: removal cannot race a new friendship
      // into a duplicate or revive an already finalized request.
      const users = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .where('user.id IN (:...ids)', { ids: [userId, friendId] })
        .orderBy('user.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      const actor = users.find((user) => user.id === actorId);
      if (!actor)
        throw new UnauthorizedException({
          statusCode: 401,
          code: 'AUTH_REQUIRED',
          message: 'A valid account is required.',
        });
      if (!actor.emailVerifiedAt)
        throw new ForbiddenException({
          statusCode: 403,
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Verify your email before continuing.',
        });
      const deleted = await manager.delete(Friendship, { userId, friendId });
      if (!deleted.affected)
        throw new NotFoundException({
          statusCode: 404,
          code: 'FRIENDSHIP_NOT_FOUND',
          message: 'Friendship not found.',
        });
    });
    await this.events.send([actorId], 'FRIEND_REMOVED', { userId: otherId });
    await this.events.send([otherId], 'FRIEND_REMOVED', { userId: actorId });
  }

  async list(actorId: UUID): Promise<FriendsResponse> {
    if (!(await this.friendships.manager.existsBy(User, { id: actorId })))
      throw new NotFoundException({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    const relationships = await this.friendships.find({
      where: [{ userId: actorId }, { friendId: actorId }],
      relations: { user: true, friend: true },
      select: {
        id: true,
        userId: true,
        friendId: true,
        user: {
          id: true,
          username: true,
          avatarUrl: true,
          elo: true,
          lastSeenAt: true,
        },
        friend: {
          id: true,
          username: true,
          avatarUrl: true,
          elo: true,
          lastSeenAt: true,
        },
      },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return {
      friends: relationships
        .map((relationship) => {
          const user =
            relationship.userId === actorId
              ? relationship.friend
              : relationship.user;
          return {
            ...toFriend(user),
            status: this.presence.get(user.id).status,
          };
        })
        .sort(
          (a, b) =>
            a.username.toLowerCase().localeCompare(b.username.toLowerCase()) ||
            a.id.localeCompare(b.id),
        ),
    };
  }
}
