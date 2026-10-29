import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PresenceService } from '../presence/presence.service.js';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { UUID } from '../common/types/api.js';
import { Friendship } from './friendships.entity.js';
import { FriendRequest } from './friend-requests.entity.js';
import { User } from '../users/user.entity.js';
import {
  toFriend,
  toFriendRequest,
  type FriendRequestResponse,
  type FriendsResponse,
} from './friends.types.js';

/** Accepted relationships live only in friendships; pending requests are separate. */
@Injectable()
export class FriendsService {
  constructor(
    @InjectRepository(Friendship)
    private readonly friendships: Repository<Friendship>,
    private readonly presence: PresenceService,
  ) {}

  async sendRequest(
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
      if (await manager.existsBy(Friendship, { userId, friendId }))
        throw new ConflictException({
          statusCode: 409,
          code: 'ALREADY_FRIENDS',
          message: 'You are already friends.',
        });
      if (
        await manager.existsBy(FriendRequest, [
          { senderId: actorId, recipientId, status: 'PENDING' },
          { senderId: recipientId, recipientId: actorId, status: 'PENDING' },
        ])
      )
        throw new ConflictException({
          statusCode: 409,
          code: 'FRIEND_REQUEST_PENDING',
          message: 'A pending friend request already exists.',
        });
      const requests = manager.getRepository(FriendRequest);
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
          message: 'Only the recipient can accept this request.',
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
      if (await manager.existsBy(Friendship, { userId, friendId }))
        throw new ConflictException({
          statusCode: 409,
          code: 'ALREADY_FRIENDS',
          message: 'You are already friends.',
        });

      pending.status = 'ACCEPTED';
      await requests.save(pending);
      await manager.getRepository(Friendship).save({ userId, friendId });
      return toFriendRequest(pending);
    });
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
