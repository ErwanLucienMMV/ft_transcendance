import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginationQueryDto } from '../common/pagination.js';
import { GameError } from '../games/game-error.js';
import { Game } from '../games/game.entity.js';
import { GameMessage } from '../messages/game-messages.entity.js';
import { isMessageContent } from '../messages/message-content.js';
import { toGameMessage } from '../messages/message-presenter.js';
import type { GameMessageResponse } from '../messages/message-presenter.js';
import { User } from '../users/user.entity.js';

export interface GameMessageHistory {
  messages: GameMessageResponse[];
  total: number;
  limit: number;
  offset: number;
}

/** PostgreSQL owns game chat; who may write is decided by the realtime room. */
@Injectable()
export class GameMessagesService {
  constructor(
    @InjectRepository(GameMessage)
    private readonly messages: Repository<GameMessage>,
    @InjectRepository(Game) private readonly games: Repository<Game>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** Throws before any database work when the text can never be stored. */
  content(value: unknown): string {
    if (!isMessageContent(value))
      throw new BadRequestException(
        'Message content must contain 1 to 2000 characters.',
      );
    return value;
  }

  /** Resolves only after the row is committed, so nothing is announced before that. */
  async send(
    userId: string,
    gameId: string,
    value: unknown,
  ): Promise<GameMessageResponse> {
    const content = this.content(value);
    const sender = await this.users.findOneByOrFail({ id: userId });
    const saved = await this.messages.save(
      this.messages.create({ gameId, userId, content }),
    );
    return toGameMessage(saved, sender);
  }

  /** Newest first. Like the game itself, a game's chat is readable by any signed-in user. */
  async history(
    gameId: string,
    page: PaginationQueryDto,
  ): Promise<GameMessageHistory> {
    if (!(await this.games.existsBy({ id: gameId })))
      throw new GameError('GAME_NOT_FOUND', 'Game not found.');
    const [rows, total] = await this.messages.findAndCount({
      where: { gameId },
      relations: { user: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: page.limit,
      skip: page.offset,
    });
    return {
      messages: rows.map((row) => toGameMessage(row, row.user)),
      total,
      limit: page.limit,
      offset: page.offset,
    };
  }
}
