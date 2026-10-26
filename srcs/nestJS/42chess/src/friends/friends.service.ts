import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { UUID } from '../common/types/api.js';
import { Friendship } from './friendships.entity.js';
import { toFriend, type FriendsResponse } from './friends.types.js';

/** Accepted relationships live only in friendships; pending requests are separate. */
@Injectable()
export class FriendsService {
  constructor(
    @InjectRepository(Friendship)
    private readonly friendships: Repository<Friendship>,
  ) {}

  async list(actorId: UUID): Promise<FriendsResponse> {
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
      friends: relationships.map((relationship) =>
        toFriend(
          relationship.userId === actorId
            ? relationship.friend
            : relationship.user,
        ),
      ),
    };
  }
}
