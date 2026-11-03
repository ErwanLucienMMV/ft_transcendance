import { Injectable, Optional } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { Game } from './game.entity.js';
import { GamePlayer } from './game-player.entity.js';
import { Move } from './move.entity.js';
import { GameError } from './game-error.js';
import type { GameState } from './game-state.js';
import { RatingService } from '../rating/rating.service.js';
import { PresenceService } from '../presence/presence.service.js';
import { ProgressionService } from '../progression/progression.service.js';
import type { XpChange } from '../progression/progression.service.js';

@Injectable()
export class GameStoreService {
  constructor(
    private readonly source: DataSource,
    private readonly ratings: RatingService = new RatingService(),
    @Optional() private readonly presence?: PresenceService,
    @Optional() private readonly progression?: ProgressionService,
  ) {}

  transaction<T>(action: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction(action);
  }

  async now(manager: EntityManager): Promise<Date> {
    const [row]: { now: Date }[] = await manager.query(
      'SELECT clock_timestamp() AS now',
    );
    return row.now;
  }

  async activeBotGames(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const [row]: { count: number }[] = await manager.query(
      `SELECT count(*)::int AS count
      FROM game_players human JOIN games g ON g.id = human."gameId"
      WHERE human."userId" = $1 AND g.status = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM game_players bot
        WHERE bot."gameId" = g.id AND bot."botDifficulty" IS NOT NULL)`,
      [userId],
    );
    return row.count;
  }

  /** First active game of any of these users, human or bot. */
  async activeGameOf(
    manager: EntityManager,
    userIds: string[],
  ): Promise<string | null> {
    const rows: { id: string }[] = await manager.query(
      `SELECT g.id FROM games g JOIN game_players p ON p."gameId" = g.id
       WHERE p."userId" = ANY($1::uuid[]) AND g.status = 'ACTIVE' LIMIT 1`,
      [userIds],
    );
    return rows[0]?.id ?? null;
  }

  async waitingGamesOf(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const [row]: { count: number }[] = await manager.query(
      `SELECT count(*)::int AS count FROM games g
       JOIN game_players p ON p."gameId" = g.id
       WHERE p."userId" = $1 AND g.status = 'WAITING'`,
      [userId],
    );
    return row.count;
  }

  /**
   * Games between two people where a side did not play its first move in time.
   * The deadline counts from the start, then from White's first move.
   */
  async dueAborts(delaySeconds: number): Promise<string[]> {
    const rows: { id: string }[] = await this.source.query(
      `SELECT g.id FROM games g
       WHERE g.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM game_players b
         WHERE b."gameId" = g.id AND b."botDifficulty" IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM moves m WHERE m."gameId" = g.id AND m.ply = 2)
       AND COALESCE((SELECT m."createdAt" FROM moves m WHERE m."gameId" = g.id AND m.ply = 1),
                    g."startedAt") <= CURRENT_TIMESTAMP - make_interval(secs => $1)
       ORDER BY g."startedAt", g.id LIMIT 100`,
      [delaySeconds],
    );
    return rows.map((row) => row.id);
  }

  /** Removes open invitations nobody accepted, with their pre-game chat. */
  async expireWaiting(maxAgeHours: number): Promise<number> {
    return this.source.transaction(async (manager) => {
      const rows: { id: string }[] = await manager.query(
        `SELECT id FROM games WHERE status = 'WAITING'
         AND "createdAt" <= CURRENT_TIMESTAMP - make_interval(hours => $1)
         ORDER BY "createdAt", id LIMIT 500 FOR UPDATE SKIP LOCKED`,
        [maxAgeHours],
      );
      if (rows.length === 0) return 0;
      const ids = rows.map((row) => row.id);
      await manager.query(
        `DELETE FROM game_messages WHERE "gameId" = ANY($1::uuid[])`,
        [ids],
      );
      await manager.query(`DELETE FROM games WHERE id = ANY($1::uuid[])`, [
        ids,
      ]);
      return ids.length;
    });
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
    failIfBusy = false,
  ): Promise<T> {
    return (await this.lockTransaction(id, action, false, failIfBusy)) as T;
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
    failIfBusy = false,
  ): Promise<T | undefined> {
    try {
      const changes: { gameId: string; userIds: string[]; active: boolean }[] =
        [];
      const awards: XpChange[] = [];
      const response = await this.source.transaction(async (manager) => {
        await manager.query(`SET LOCAL lock_timeout = '12s'`);
        const game = await manager.findOne(Game, {
          where: { id },
          lock: {
            mode: 'pessimistic_write',
            onLocked: skipBusy
              ? 'skip_locked'
              : failIfBusy
                ? 'nowait'
                : undefined,
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
        if (
          wasActive &&
          game.status === 'FINISHED' &&
          game.rated &&
          game.result !== null &&
          state.players.every((player) => player.userId !== null)
        ) {
          await this.ratings.applyFinishedGame(manager, game, state.players);
        }
        // Experience goes with the result, in the same transaction, once per game.
        if (wasActive && game.status === 'FINISHED' && this.progression)
          awards.push(...(await this.progression.awardGame(manager, game.id)));
        if (before !== game.status) {
          const seats = await manager.findBy(GamePlayer, { gameId: game.id });
          changes.push({
            gameId: game.id,
            userIds: seats.flatMap((player) =>
              player.userId === null ? [] : [player.userId],
            ),
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
      if (awards.length) await this.progression?.settle(awards);
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

  /**
   * A coherent read without the game lock, with the database time it was taken at:
   * clocks can be brought up to date in memory without writing anything.
   */
  observe(id: string): Promise<{ state: GameState; now: number }> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const game = await manager.findOneBy(Game, { id });
      if (!game) throw new GameError('GAME_NOT_FOUND', 'Game does not exist.');
      const state = await this.state(manager, game);
      return { state, now: (await this.now(manager)).getTime() };
    });
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
