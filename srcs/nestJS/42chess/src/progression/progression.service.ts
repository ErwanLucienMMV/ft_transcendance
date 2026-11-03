import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type { BotDifficulty } from '../bots/bot-engine.js';
import type { Pagination } from '../common/types/api.js';
import { UserEvents } from '../social/user-events.js';
import {
  gameXp,
  levelFor,
  levelProgress,
  puzzleXp,
  TODAY_SQL as TODAY,
  XP_RULES,
  xpForLevel,
} from './progression.rules.js';
import type {
  AchievementMetric,
  GameOutcome,
  LevelProgress,
} from './progression.rules.js';

type XpSource = 'GAME' | 'PUZZLE' | 'ACHIEVEMENT';

/** XP a player had before a finished game or puzzle; settled once it is committed. */
export interface XpChange {
  userId: string;
  xpBefore: number;
}

export interface PuzzleReward {
  xp: number;
  /** The daily streak after this puzzle, or null for a puzzle from the archive. */
  streak: number | null;
}

export interface Achievement {
  code: string;
  name: string;
  description: string;
  goal: number;
  xp: number;
}

type Metrics = Record<AchievementMetric, number>;

/** Games that count for stats and achievements: finished with a result, two moves each. */
const COUNTED_GAME = `g.status = 'FINISHED' AND g.result IS NOT NULL
  AND EXISTS (SELECT 1 FROM moves m WHERE m."gameId" = g.id AND m.ply = ${XP_RULES.minimumMovesEach * 2})`;
const WON = `((g.result = 'WHITE_WIN' AND me.color = 'WHITE') OR (g.result = 'BLACK_WIN' AND me.color = 'BLACK'))`;
const LOST = `((g.result = 'WHITE_WIN' AND me.color = 'BLACK') OR (g.result = 'BLACK_WIN' AND me.color = 'WHITE'))`;

/**
 * Experience, levels, the daily puzzle streak, achievements and the leaderboard.
 * Awards are written in the transaction that finishes the game or the puzzle, once
 * per game or puzzle (xp_events is unique per source); achievements follow after commit.
 */
@Injectable()
export class ProgressionService {
  private readonly logger = new Logger(ProgressionService.name);
  private catalogue: Promise<
    (Achievement & { metric: AchievementMetric })[]
  > | null = null;

  constructor(
    private readonly source: DataSource,
    @Optional() private readonly events?: UserEvents,
  ) {}

  /** In the transaction that finished the game: XP for each human seat. */
  async awardGame(manager: EntityManager, gameId: string): Promise<XpChange[]> {
    const seats = (await manager.query(
      `SELECT me."userId", me.color, g.result, opp."botDifficulty",
         (SELECT count(*)::int FROM moves m WHERE m."gameId" = g.id) AS plies
       FROM game_players me
       JOIN games g ON g.id = me."gameId"
       JOIN game_players opp ON opp."gameId" = g.id AND opp.id <> me.id
       JOIN users u ON u.id = me."userId" AND u."deletedAt" IS NULL
       WHERE g.id = $1 AND g.status = 'FINISHED' AND g.result IS NOT NULL
       ORDER BY me."userId"`,
      [gameId],
    )) as {
      userId: string;
      color: 'WHITE' | 'BLACK';
      result: 'WHITE_WIN' | 'BLACK_WIN' | 'DRAW';
      botDifficulty: BotDifficulty | null;
      plies: number;
    }[];
    const changes: XpChange[] = [];
    for (const seat of seats) {
      const outcome: GameOutcome =
        seat.result === 'DRAW'
          ? 'draw'
          : (seat.result === 'WHITE_WIN') === (seat.color === 'WHITE')
            ? 'win'
            : 'loss';
      const amount = gameXp(outcome, seat.plies, seat.botDifficulty);
      changes.push(
        await this.grant(manager, seat.userId, 'GAME', gameId, amount),
      );
    }
    return changes;
  }

  /**
   * In the transaction that solved the puzzle. Rewards go to a puzzle solved on the
   * player's only attempt at it: a second attempt is practice. The daily puzzle,
   * solved on its own day, also extends the streak.
   */
  async awardPuzzle(
    manager: EntityManager,
    userId: string,
    puzzleId: string,
    hintUsed: boolean,
  ): Promise<{ change: XpChange; reward: PuzzleReward } | null> {
    // The day the attempt started: a daily puzzle begun before midnight UTC and
    // solved after it is still that day's puzzle.
    const [row] = (await manager.query(
      `SELECT count(*)::int AS attempts,
         (min(a."createdAt") AT TIME ZONE 'UTC')::date::text AS day,
         EXISTS (SELECT 1 FROM daily_puzzles d WHERE d."puzzleId" = $2
           AND d.date = (min(a."createdAt") AT TIME ZONE 'UTC')::date) AS daily
       FROM puzzle_attempts a WHERE a."userId" = $1 AND a."puzzleId" = $2`,
      [userId, puzzleId],
    )) as { attempts: number; day: string; daily: boolean }[];
    if (row.attempts !== 1) return null;
    let streak: number | null = null;
    if (row.daily) {
      const [progress] = (await manager.query(
        // A later day already counted keeps the streak as it is.
        `INSERT INTO user_progress ("userId", "puzzleStreak", "bestPuzzleStreak", "lastStreakDate")
         VALUES ($1, 1, 1, $2::date)
         ON CONFLICT ("userId") DO UPDATE SET
           "puzzleStreak" = CASE
             WHEN user_progress."lastStreakDate" >= $2::date THEN user_progress."puzzleStreak"
             WHEN user_progress."lastStreakDate" = $2::date - 1 THEN user_progress."puzzleStreak" + 1
             ELSE 1 END,
           "bestPuzzleStreak" = GREATEST(user_progress."bestPuzzleStreak", CASE
             WHEN user_progress."lastStreakDate" >= $2::date THEN user_progress."puzzleStreak"
             WHEN user_progress."lastStreakDate" = $2::date - 1 THEN user_progress."puzzleStreak" + 1
             ELSE 1 END),
           "lastStreakDate" = GREATEST(user_progress."lastStreakDate", $2::date),
           "updatedAt" = now()
         RETURNING "puzzleStreak"`,
        [userId, row.day],
      )) as { puzzleStreak: number }[];
      streak = progress.puzzleStreak;
    }
    const xp = puzzleXp(row.daily, hintUsed, streak ?? 0);
    const change = await this.grant(manager, userId, 'PUZZLE', puzzleId, xp);
    return { change, reward: { xp, streak } };
  }

  /**
   * After commit: unlocks the achievements these players have now reached, then tells
   * their open pages about new achievements and levels. Never throws: the game or the
   * puzzle is already saved, and the next settlement unlocks anything missed.
   */
  async settle(changes: XpChange[]): Promise<void> {
    for (const change of changes) {
      try {
        const { unlocked, xp } = await this.source.transaction((manager) =>
          this.unlock(manager, change.userId),
        );
        for (const achievement of unlocked)
          void this.events?.send(
            [change.userId],
            'ACHIEVEMENT_UNLOCKED',
            achievement,
          );
        const level = levelFor(xp);
        if (level > levelFor(change.xpBefore))
          void this.events?.send([change.userId], 'LEVEL_UP', {
            level,
            xp,
          });
      } catch (error: unknown) {
        this.logger.warn(
          `Achievements of ${change.userId} were not settled: ${String(error)}`,
        );
      }
    }
  }

  async achievements() {
    this.catalogue ??= this.source
      .query(
        `SELECT code, name, description, metric, goal, xp FROM achievements ORDER BY position`,
      )
      .then((rows) => rows as (Achievement & { metric: AchievementMetric })[])
      .catch((error: unknown) => {
        this.catalogue = null;
        throw error;
      });
    return this.catalogue;
  }

  /** The rules page: XP table, first levels and the achievements. */
  async rules() {
    return {
      xp: XP_RULES,
      levels: Array.from({ length: 10 }, (_, index) => ({
        level: index + 1,
        xp: xpForLevel(index + 1),
      })),
      achievements: (await this.achievements()).map(
        ({ code, name, description, goal, xp }) => ({
          code,
          name,
          description,
          goal,
          xp,
        }),
      ),
    };
  }

  /** Public statistics of a profile: rank, results by kind of game, level and puzzles. */
  async stats(userId: string) {
    const [user] = (await this.source.query(
      `SELECT u.elo, u."gamesPlayed", u."gamesWon", u."gamesDraw", u."gamesLost",
         COALESCE(p.xp, 0) AS xp,
         CASE WHEN p."lastStreakDate" >= ${TODAY} - 1 THEN p."puzzleStreak" ELSE 0 END AS streak,
         COALESCE(p."bestPuzzleStreak", 0) AS "bestStreak",
         COALESCE(p."lastStreakDate" = ${TODAY}, false) AS "solvedToday"
       FROM users u LEFT JOIN user_progress p ON p."userId" = u.id
       WHERE u.id = $1 AND u."emailVerifiedAt" IS NOT NULL`,
      [userId],
    )) as {
      elo: number;
      gamesPlayed: number;
      gamesWon: number;
      gamesDraw: number;
      gamesLost: number;
      xp: number;
      streak: number;
      bestStreak: number;
      solvedToday: boolean;
    }[];
    if (!user) this.notFound();
    const [[ranking], [games], [puzzles]] = (await Promise.all([
      this.source.query(
        `SELECT count(*)::int AS "rankedPlayers",
           count(*) FILTER (WHERE elo > $1)::int AS above
         FROM users WHERE "emailVerifiedAt" IS NOT NULL AND "gamesPlayed" > 0`,
        [user.elo],
      ),
      this.source.query(
        `SELECT
           count(*) FILTER (WHERE opp."userId" IS NOT NULL AND NOT g.rated)::int AS "casualPlayed",
           count(*) FILTER (WHERE opp."userId" IS NOT NULL AND NOT g.rated AND ${WON})::int AS "casualWon",
           count(*) FILTER (WHERE opp."userId" IS NOT NULL AND NOT g.rated AND g.result = 'DRAW')::int AS "casualDrawn",
           count(*) FILTER (WHERE opp."userId" IS NOT NULL AND NOT g.rated AND ${LOST})::int AS "casualLost",
           count(*) FILTER (WHERE opp."userId" IS NULL)::int AS "botPlayed",
           count(*) FILTER (WHERE opp."userId" IS NULL AND ${WON})::int AS "botWon",
           count(*) FILTER (WHERE opp."userId" IS NULL AND g.result = 'DRAW')::int AS "botDrawn",
           count(*) FILTER (WHERE opp."userId" IS NULL AND ${LOST})::int AS "botLost"
         FROM game_players me
         JOIN games g ON g.id = me."gameId"
         JOIN game_players opp ON opp."gameId" = g.id AND opp.id <> me.id
         WHERE me."userId" = $1 AND g.status = 'FINISHED' AND g.result IS NOT NULL`,
        [userId],
      ),
      this.source.query(
        `SELECT count(*)::int AS solved FROM xp_events WHERE "userId" = $1 AND source = 'PUZZLE'`,
        [userId],
      ),
    ])) as [
      { rankedPlayers: number; above: number }[],
      Record<string, number>[],
      { solved: number }[],
    ];
    return {
      rank: user.gamesPlayed > 0 ? ranking.above + 1 : null,
      rankedPlayers: ranking.rankedPlayers,
      rated: {
        played: user.gamesPlayed,
        won: user.gamesWon,
        drawn: user.gamesDraw,
        lost: user.gamesLost,
      },
      casual: {
        played: games.casualPlayed,
        won: games.casualWon,
        drawn: games.casualDrawn,
        lost: games.casualLost,
      },
      bots: {
        played: games.botPlayed,
        won: games.botWon,
        drawn: games.botDrawn,
        lost: games.botLost,
      },
      progression: levelProgress(user.xp),
      puzzles: {
        solved: puzzles.solved,
        streak: user.streak,
        bestStreak: user.bestStreak,
        solvedToday: user.solvedToday,
      },
    };
  }

  /** Every achievement with this player's progress towards it. */
  async progress(userId: string) {
    const [exists] = (await this.source.query(
      `SELECT 1 FROM users WHERE id = $1 AND "emailVerifiedAt" IS NOT NULL`,
      [userId],
    )) as unknown[];
    if (!exists) this.notFound();
    const [metrics, unlocked, catalogue] = await Promise.all([
      this.metrics(this.source.manager, userId),
      this.source.query(
        `SELECT code, "unlockedAt" FROM user_achievements WHERE "userId" = $1`,
        [userId],
      ) as Promise<{ code: string; unlockedAt: Date }[]>,
      this.achievements(),
    ]);
    const dates = new Map(unlocked.map((row) => [row.code, row.unlockedAt]));
    return {
      achievements: catalogue.map(
        ({ code, name, description, metric, goal, xp }) => {
          const at = dates.get(code);
          return {
            code,
            name,
            description,
            goal,
            xp,
            progress: at ? goal : Math.min(goal, metrics[metric]),
            unlockedAt: at ? at.toISOString() : null,
          };
        },
      ),
    };
  }

  /**
   * Verified players with at least one rated game, best rating first. Equal ratings
   * share a rank.
   */
  async leaderboard(pagination: Pagination) {
    const [rows, [{ total }]] = (await Promise.all([
      this.source.query(
        `SELECT u.id, u.username, u."avatarUrl", u.elo, u."gamesPlayed", u."gamesWon",
           u."gamesDraw", u."gamesLost", COALESCE(p.xp, 0) AS xp,
           RANK() OVER (ORDER BY u.elo DESC)::int AS rank
         FROM users u LEFT JOIN user_progress p ON p."userId" = u.id
         WHERE u."emailVerifiedAt" IS NOT NULL AND u."gamesPlayed" > 0
         ORDER BY u.elo DESC, u."gamesPlayed" DESC, lower(u.username), u.id
         LIMIT $1 OFFSET $2`,
        [pagination.limit, pagination.offset],
      ),
      this.source.query(
        `SELECT count(*)::int AS total FROM users
         WHERE "emailVerifiedAt" IS NOT NULL AND "gamesPlayed" > 0`,
      ),
    ])) as [
      {
        id: string;
        username: string;
        avatarUrl: string | null;
        elo: number;
        gamesPlayed: number;
        gamesWon: number;
        gamesDraw: number;
        gamesLost: number;
        xp: number;
        rank: number;
      }[],
      { total: number }[],
    ];
    return {
      total,
      items: rows.map(({ xp, ...row }) => ({ ...row, level: levelFor(xp) })),
    };
  }

  /** The player's level, for their own pages. */
  async level(userId: string): Promise<LevelProgress> {
    const [row] = (await this.source.query(
      `SELECT xp FROM user_progress WHERE "userId" = $1`,
      [userId],
    )) as { xp: number }[];
    return levelProgress(row?.xp ?? 0);
  }

  private async unlock(
    manager: EntityManager,
    userId: string,
  ): Promise<{ unlocked: Achievement[]; xp: number }> {
    const catalogue = await this.achievements();
    const unlocked: Achievement[] = [];
    // Achievement XP can reach a level achievement: look again until nothing changes.
    for (let pass = 0; pass < 3; pass++) {
      const metrics = await this.metrics(manager, userId);
      const reached = catalogue.filter(
        (achievement) => metrics[achievement.metric] >= achievement.goal,
      );
      if (reached.length === 0) break;
      const inserted = (await manager.query(
        `INSERT INTO user_achievements ("userId", code)
         SELECT $1, unnest($2::varchar[])
         ON CONFLICT DO NOTHING RETURNING code`,
        [userId, reached.map((achievement) => achievement.code)],
      )) as { code: string }[];
      if (inserted.length === 0) break;
      for (const { code } of inserted) {
        const achievement = catalogue.find((item) => item.code === code)!;
        await this.grant(manager, userId, 'ACHIEVEMENT', code, achievement.xp);
        unlocked.push({
          code,
          name: achievement.name,
          description: achievement.description,
          goal: achievement.goal,
          xp: achievement.xp,
        });
      }
    }
    const [row] = (await manager.query(
      `SELECT xp FROM user_progress WHERE "userId" = $1`,
      [userId],
    )) as { xp: number }[];
    return { unlocked, xp: row?.xp ?? 0 };
  }

  private async metrics(
    manager: EntityManager,
    userId: string,
  ): Promise<Metrics> {
    const [row] = (await manager.query(
      `WITH counted AS MATERIALIZED (
         SELECT opp."userId" IS NULL AS bot, opp."botDifficulty" AS level, ${WON} AS won
         FROM game_players me JOIN games g ON g.id = me."gameId"
         JOIN game_players opp ON opp."gameId" = g.id AND opp.id <> me.id
         WHERE me."userId" = $1 AND ${COUNTED_GAME})
       SELECT
         (SELECT count(*) FILTER (WHERE NOT bot)::int FROM counted) AS "HUMAN_GAMES",
         (SELECT count(*) FILTER (WHERE NOT bot AND won)::int FROM counted) AS "HUMAN_WINS",
         (SELECT jsonb_object_agg(level, wins) FROM (
            SELECT level, count(*)::int AS wins FROM counted
            WHERE bot AND won GROUP BY level) bots) AS bots,
         (SELECT count(*)::int FROM xp_events WHERE "userId" = $1 AND source = 'PUZZLE') AS "PUZZLES_SOLVED",
         (SELECT COALESCE(max("bestPuzzleStreak"), 0) FROM user_progress WHERE "userId" = $1) AS "PUZZLE_STREAK",
         GREATEST(
           (SELECT elo FROM users WHERE id = $1),
           (SELECT max("ratingAfter") FROM rating_history WHERE "userId" = $1)) AS "RATING",
         (SELECT COALESCE(max(xp), 0) FROM user_progress WHERE "userId" = $1) AS xp`,
      [userId],
    )) as (Omit<Metrics, 'LEVEL' | `BOT_${string}`> & {
      bots: Partial<Record<BotDifficulty, number>> | null;
      xp: number;
    })[];
    return {
      HUMAN_GAMES: row.HUMAN_GAMES,
      HUMAN_WINS: row.HUMAN_WINS,
      BOT_EASY_WINS: row.bots?.EASY ?? 0,
      BOT_MEDIUM_WINS: row.bots?.MEDIUM ?? 0,
      BOT_HARD_WINS: row.bots?.HARD ?? 0,
      PUZZLES_SOLVED: row.PUZZLES_SOLVED,
      PUZZLE_STREAK: row.PUZZLE_STREAK,
      RATING: row.RATING ?? 0,
      LEVEL: levelFor(row.xp),
    };
  }

  /** Adds XP once per (player, source, reference); a repeat adds nothing. */
  private async grant(
    manager: EntityManager,
    userId: string,
    source: XpSource,
    refId: string,
    amount: number,
  ): Promise<XpChange> {
    if (amount > 0) {
      const [granted] = (await manager.query(
        `WITH inserted AS (
           INSERT INTO xp_events ("userId", source, "refId", amount) VALUES ($1, $2, $3, $4)
           ON CONFLICT ("userId", source, "refId") DO NOTHING RETURNING amount)
         INSERT INTO user_progress ("userId", xp) SELECT $1, amount FROM inserted
         ON CONFLICT ("userId") DO UPDATE SET xp = user_progress.xp + EXCLUDED.xp, "updatedAt" = now()
         RETURNING xp`,
        [userId, source, refId, amount],
      )) as { xp: number }[];
      if (granted) return { userId, xpBefore: granted.xp - amount };
    }
    const [row] = (await manager.query(
      `SELECT xp FROM user_progress WHERE "userId" = $1`,
      [userId],
    )) as { xp: number }[];
    return { userId, xpBefore: row?.xp ?? 0 };
  }

  private notFound(): never {
    throw new NotFoundException({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
      message: 'User not found.',
    });
  }
}
