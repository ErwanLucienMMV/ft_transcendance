import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/user.entity.js';
import { PresenceService } from '../presence/presence.service.js';

@Injectable()
export class FriendsService {
  constructor(
    private readonly source: DataSource,
    private readonly presence: PresenceService,
  ) {}

  async list(userId: string) {
    if (!(await this.source.getRepository(User).existsBy({ id: userId })))
      throw new NotFoundException({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    const rows: { id: string; username: string; elo: number }[] =
      await this.source.query(
        `SELECT u.id, u.username, u.elo FROM friendships f JOIN users u ON u.id =
       CASE WHEN f."userId" = $1 THEN f."friendId" ELSE f."userId" END
       WHERE f."userId" = $1 OR f."friendId" = $1 ORDER BY LOWER(u.username), u.id`,
        [userId],
      );
    return {
      friends: rows.map((user) => ({
        id: user.id,
        username: user.username,
        elo: user.elo,
        status: this.presence.get(user.id).status,
      })),
    };
  }
}
