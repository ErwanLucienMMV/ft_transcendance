import { Injectable, Optional } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { Game } from './game.entity.js';
import { GamePlayer } from './game-player.entity.js';
import { Move } from './move.entity.js';
import { GameError } from './game-error.js';
import type { GameState } from './game-state.js';
import { RatingService } from '../rating/rating.service.js';
import { PresenceService } from '../presence/presence.service.js';

@Injectable()
export class GameStoreService {
  constructor(
    private readonly source: DataSource,
    private readonly ratings: RatingService = new RatingService(),
    @Optional() private readonly presence?: PresenceService,
  ) {}

  transaction<T>(action: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction(action);
  }

  async dueClocks(): Promise<string[]> {
    const rows: { id: string }[] = await this.source.query(`SELECT id FROM games
      WHERE status='ACTIVE' AND "clockDeadline" <= CURRENT_TIMESTAMP
      ORDER BY "clockDeadline",id LIMIT 100 FOR UPDATE SKIP LOCKED`);
    return rows.map((row) => row.id);
  }

  /** Every mutating operation locks the parent before reading its children. */
  async locked<T>(
    id: string,
    action: (manager: EntityManager, state: GameState) => Promise<T>,
  ): Promise<T> {
    return (await this.lockTransaction(id, action, false)) as T;
  }

  /** Background work skips busy parents and retries their durable deadline later. */
  async tryLocked(
    id: string,
    action: (manager: EntityManager, state: GameState) => Promise<void>,
  ): Promise<void> {
    await this.lockTransaction(id, action, true);
  }

  private async lockTransaction<T>(
    id: string,
    action: (manager: EntityManager, state: GameState) => Promise<T>,
    skipBusy: boolean,
  ): Promise<T | undefined> {
    try {
      const changes: { gameId: string; userIds: string[]; active: boolean }[] =
        [];
      const response = await this.source.transaction(async (manager) => {
        await manager.query(`SET LOCAL lock_timeout = '12s'`);
        const game = await manager.findOne(Game, {
          where: { id },
          lock: {
            mode: 'pessimistic_write',
            onLocked: skipBusy ? 'skip_locked' : undefined,
          },
        });
        if (!game && skipBusy) return undefined;
        if (!game)
          throw new GameError('GAME_NOT_FOUND', 'Game does not exist.');
        const state = await this.state(manager, game);
        const before = game.status;
        const wasActive = game.status === 'ACTIVE';
        const result = await action(manager, state);
        // All terminal actions, including background clocks, finalize here.
        // A rating failure rejects this same transaction, including game/move writes.
        if (wasActive && game.status === 'FINISHED') {
          await this.ratings.applyFinishedGame(manager, game, state.players);
        }
        if (before !== game.status) {
          const seats = await manager.findBy(GamePlayer, { gameId: game.id });
          changes.push({
            gameId: game.id,
            userIds: seats.map((player) => player.userId),
            active: game.status === 'ACTIVE',
          });
        }
        return result;
      });
      for (const change of changes)
        this.presence?.setGameStatus(
          change.gameId,
          change.userIds,
          change.active,
        );
      return response;
    } catch (error: unknown) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '55P03'
      ) {
        throw new GameError(
          'GAME_BUSY',
          'Another action is still updating this game.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  /** A coherent game + seats + history, even while another connection plays. */
  get(id: string): Promise<GameState> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const game = await manager.findOneBy(Game, { id });
      if (!game) throw new GameError('GAME_NOT_FOUND', 'Game does not exist.');
      return this.state(manager, game);
    });
  }

  async state(manager: EntityManager, game: Game): Promise<GameState> {
    const players = await manager.find(GamePlayer, {
      where: { gameId: game.id },
      order: { color: 'DESC' },
    });
    const moves = await manager.find(Move, {
      where: { gameId: game.id },
      order: { ply: 'ASC' },
    });
    return { game, players, moves };
  }
}
