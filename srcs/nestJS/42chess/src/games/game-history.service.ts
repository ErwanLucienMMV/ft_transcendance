import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { User } from '../users/user.entity.js';
import type { PaginatedResponse, Pagination } from '../common/types/api.js';
import { GameError } from './game-error.js';
import { Game } from './game.entity.js';
import { GamePlayer } from './game-player.entity.js';
import { Move } from './move.entity.js';
import type { GameHistoryItem, GameOutcome } from './game-api.types.js';
import { playerRef } from './player-ref.js';

/** Finished games of one player, newest first; public like GET /games/:id. */
@Injectable()
export class GameHistoryService {
  constructor(private readonly source: DataSource) {}

  async forUser(
    userId: string,
    { limit, offset }: Pagination,
  ): Promise<PaginatedResponse<GameHistoryItem>> {
    if (!(await this.source.getRepository(User).existsBy({ id: userId })))
      throw new GameError('USER_NOT_FOUND', 'User does not exist.');
    const finished = this.source
      .getRepository(GamePlayer)
      .createQueryBuilder('seat')
      .innerJoin(Game, 'game', 'game.id = seat.gameId')
      .where('seat.userId = :userId', { userId })
      .andWhere(`game.status = 'FINISHED'`);
    const [total, rows] = await Promise.all([
      finished.clone().getCount(),
      finished
        .clone()
        .select(['seat.gameId AS "gameId"', 'seat.color AS "color"'])
        .orderBy('game.finishedAt', 'DESC')
        .addOrderBy('game.id', 'DESC')
        .limit(limit)
        .offset(offset)
        .getRawMany<Pick<GamePlayer, 'gameId' | 'color'>>(),
    ]);
    if (rows.length === 0) return { items: [], total, limit, offset };
    const ids = rows.map((row) => row.gameId);
    const [games, opponents, counts] = await Promise.all([
      this.source.getRepository(Game).findBy({ id: In(ids) }),
      this.source
        .getRepository(GamePlayer)
        .find({ where: { gameId: In(ids) }, relations: { user: true } }),
      this.source
        .getRepository(Move)
        .createQueryBuilder('move')
        .select('move.gameId', 'gameId')
        .addSelect('COUNT(*)::int', 'count')
        .where('move.gameId IN (:...ids)', { ids })
        .groupBy('move.gameId')
        .getRawMany<{ gameId: string; count: number }>(),
    ]);
    const items = rows.map(({ gameId, color }): GameHistoryItem => {
      const game = games.find((game) => game.id === gameId)!;
      const seat = opponents.find(
        (seat) => seat.gameId === gameId && seat.color !== color,
      );
      if (!seat || !game.startedAt || !game.finishedAt || !game.result)
        throw new GameError(
          'INVALID_GAME_HISTORY',
          'A finished game has an incomplete record.',
        );
      return {
        id: gameId,
        color,
        opponent: playerRef(seat),
        outcome: outcome(game.result, color),
        reason: game.endReason,
        timeControl: {
          initialTime: game.initialTime,
          increment: game.increment,
        },
        moveCount: counts.find((count) => count.gameId === gameId)?.count ?? 0,
        startedAt: game.startedAt.toISOString(),
        endedAt: game.finishedAt.toISOString(),
      };
    });
    return { items, total, limit, offset };
  }
}

function outcome(
  result: Game['result'],
  color: GamePlayer['color'],
): GameOutcome {
  if (result === 'DRAW') return 'DRAW';
  return (result === 'WHITE_WIN') === (color === 'WHITE') ? 'WIN' : 'LOSS';
}
