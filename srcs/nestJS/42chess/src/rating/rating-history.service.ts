import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity.js';
import type { Pagination } from '../common/types/api.js';
import { RatingHistory } from './rating-history.entity.js';
import { toRatingHistoryResponse } from './rating.types.js';
import type { RatingHistoryResponse } from './rating.types.js';

@Injectable()
export class RatingHistoryService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RatingHistory)
    private readonly history: Repository<RatingHistory>,
  ) {}

  async forUser(
    id: string,
    pagination: Pagination,
  ): Promise<RatingHistoryResponse> {
    if (!(await this.users.existsBy({ id }))) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User does not exist.',
      });
    }
    const rows = await this.history.find({
      where: { userId: id },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: pagination.limit,
      skip: pagination.offset,
    });
    return toRatingHistoryResponse(rows);
  }
}
