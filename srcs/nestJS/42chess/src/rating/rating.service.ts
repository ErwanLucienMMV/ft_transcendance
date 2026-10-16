import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { EntityManager } from 'typeorm';
import { Game, INITIAL_FEN } from '../games/game.entity.js';
import type { GameResult } from '../games/game.entity.js';
import { GamePlayer } from '../games/game-player.entity.js';
import { User } from '../users/user.entity.js';
import { RatingHistory } from './rating-history.entity.js';
import { RatingError } from './rating-error.js';
import { calculateGameRatings } from './elo-calculation.js';
import type { EloScore } from './elo-calculation.js';

export type RatingApplication = 'APPLIED' | 'ALREADY_APPLIED' | 'UNRATED';

/** SCRUM-212/214: the caller owns the transaction and must propagate failures. */
@Injectable()
export class RatingService {
  async applyFinishedGame(
    manager: EntityManager,
    game: Game,
    players: readonly GamePlayer[],
  ): Promise<RatingApplication> {
    if (!manager.queryRunner?.isTransactionActive) {
      throw new RatingError(
        'RATING_TRANSACTION_REQUIRED',
        'An active transaction is required.',
      );
    }
    if (
      !game ||
      !isUUID(game.id) ||
      game.status !== 'FINISHED' ||
      !['WHITE_WIN', 'BLACK_WIN', 'DRAW'].includes(game.result ?? '') ||
      !(game.startedAt instanceof Date) ||
      !Number.isFinite(game.startedAt.getTime()) ||
      !(game.finishedAt instanceof Date) ||
      !Number.isFinite(game.finishedAt.getTime()) ||
      game.finishedAt < game.startedAt
    ) {
      throw new RatingError(
        'INVALID_RATING_GAME',
        'A valid finished game is required.',
      );
    }
    this.validatePlayers(game.id, players);

    // Parent first, then users: identical ordering to GameStoreService callers.
    const stored = await manager.findOne(Game, {
      where: { id: game.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !stored ||
      stored.status !== game.status ||
      stored.result !== game.result ||
      stored.initialFen !== game.initialFen ||
      stored.startedAt?.getTime() !== game.startedAt.getTime() ||
      stored.finishedAt?.getTime() !== game.finishedAt.getTime()
    ) {
      throw new RatingError(
        'INVALID_RATING_GAME',
        'The supplied result must match the stored game.',
      );
    }
    const seats = await manager.findBy(GamePlayer, { gameId: game.id });
    this.validatePlayers(game.id, seats);
    if (
      seats.some(
        (seat) =>
          !players.some(
            (player) =>
              player.userId === seat.userId && player.color === seat.color,
          ),
      )
    ) {
      throw new RatingError(
        'INVALID_RATING_PARTICIPANTS',
        'Participants must match the stored seats.',
      );
    }

    const users = new Map<string, User>();
    for (const id of seats.map((seat) => seat.userId).sort()) {
      const user = await manager.findOne(User, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user)
        throw new RatingError(
          'INVALID_RATING_PARTICIPANTS',
          'A participant account is missing.',
        );
      users.set(id, user);
    }
    const white = users.get(
      seats.find((seat) => seat.color === 'WHITE')!.userId,
    )!;
    const black = users.get(
      seats.find((seat) => seat.color === 'BLACK')!.userId,
    )!;
    const history = await manager.findBy(RatingHistory, { gameId: game.id });
    if (history.length) {
      this.validateHistory(history, white.id, black.id, game.result!);
      if (game.initialFen !== INITIAL_FEN) {
        throw new RatingError(
          'INCONSISTENT_RATING_HISTORY',
          'An unrated game has rating history.',
        );
      }
      return 'ALREADY_APPLIED';
    }
    if (game.initialFen !== INITIAL_FEN) return 'UNRATED';

    const ratings = calculateGameRatings({
      ratingA: white.elo,
      ratingB: black.elo,
      scoreA: score(game.result!),
    });
    for (const [user, adjustment, actual] of [
      [white, ratings.a, score(game.result!)],
      [black, ratings.b, 1 - score(game.result!)],
    ] as const) {
      await manager.update(User, user.id, {
        elo: adjustment.ratingAfter,
        gamesPlayed: user.gamesPlayed + 1,
        gamesWon: user.gamesWon + Number(actual === 1),
        gamesDraw: user.gamesDraw + Number(actual === 0.5),
        gamesLost: user.gamesLost + Number(actual === 0),
      });
    }
    // Keep the database's unique (userId, gameId) constraint as the final guard.
    await manager.insert(RatingHistory, [
      {
        userId: white.id,
        gameId: game.id,
        ratingBefore: ratings.a.ratingBefore,
        ratingAfter: ratings.a.ratingAfter,
      },
      {
        userId: black.id,
        gameId: game.id,
        ratingBefore: ratings.b.ratingBefore,
        ratingAfter: ratings.b.ratingAfter,
      },
    ]);
    return 'APPLIED';
  }

  private validatePlayers(
    gameId: string,
    players: readonly GamePlayer[],
  ): void {
    if (
      !Array.isArray(players) ||
      players.length !== 2 ||
      players.some(
        (player) =>
          !player ||
          !isUUID(player.userId) ||
          player.gameId !== gameId ||
          !['WHITE', 'BLACK'].includes(player.color),
      ) ||
      players[0].userId === players[1].userId ||
      players[0].color === players[1].color
    ) {
      throw new RatingError(
        'INVALID_RATING_PARTICIPANTS',
        'Two distinct seated participants are required.',
      );
    }
  }

  private validateHistory(
    rows: RatingHistory[],
    whiteId: string,
    blackId: string,
    result: GameResult,
  ): void {
    const white = rows.find((row) => row.userId === whiteId);
    const black = rows.find((row) => row.userId === blackId);
    let consistent = rows.length === 2 && !!white && !!black;
    if (consistent) {
      try {
        const ratings = calculateGameRatings({
          ratingA: white!.ratingBefore,
          ratingB: black!.ratingBefore,
          scoreA: score(result),
        });
        consistent =
          ratings.a.ratingAfter === white!.ratingAfter &&
          ratings.b.ratingAfter === black!.ratingAfter;
      } catch {
        consistent = false;
      }
    }
    if (!consistent) {
      throw new RatingError(
        'INCONSISTENT_RATING_HISTORY',
        'Rating history does not match both participants and the result.',
      );
    }
  }
}

function score(result: GameResult): EloScore {
  return result === 'DRAW' ? 0.5 : result === 'WHITE_WIN' ? 1 : 0;
}
