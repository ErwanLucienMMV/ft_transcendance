import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { User } from '../users/user.entity.js';
import { Puzzle } from './puzzles.entity.js';
import { PuzzleAttempt } from './puzzle-attempts.entity.js';
import { DailyPuzzle } from './daily-puzzles.entity.js';
import { PuzzleRulesService } from './puzzle-rules.service.js';
import { toDailyPuzzleResponse } from './puzzle-presenter.js';
import { puzzleError } from './puzzle-errors.js';
import type { DailyPuzzleResponse } from './puzzle.types.js';
import type {
  PuzzleArchiveResponse,
  PuzzleProgressResponse,
  PuzzleSessionResponse,
  PuzzleTurnResponse,
} from './puzzle-session.types.js';
import { ProgressionService } from '../progression/progression.service.js';
import type {
  PuzzleReward,
  XpChange,
} from '../progression/progression.service.js';
import {
  TODAY_SQL as TODAY,
  XP_RULES,
} from '../progression/progression.rules.js';
import type { Pagination } from '../common/types/api.js';

const MAX_MISTAKES = XP_RULES.maxPuzzleMistakes;

@Injectable()
export class PuzzlesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PuzzlesService.name);
  constructor(
    private readonly source: DataSource,
    private readonly rules: PuzzleRulesService,
    @Optional() private readonly progression?: ProgressionService,
  ) {}

  /** An empty catalogue makes the puzzle page fail: say how to fill it. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const [{ count }] = (await this.source.query(
        `SELECT count(*)::int AS count FROM puzzles
          WHERE "validatedAt" IS NOT NULL AND themes IS NOT NULL`,
      )) as { count: number }[];
      if (count === 0)
        this.logger.warn(
          'No validated puzzle: the puzzle page answers PUZZLE_CATALOG_EMPTY. ' +
            'Import the catalogue with `make puzzles`.',
        );
      else this.logger.log(`${count} validated puzzles available`);
    } catch {
      // Diagnostics only: never block startup.
    }
  }

  /** UTC day and transaction lock come from PostgreSQL, shared by every API replica. */
  async daily(): Promise<DailyPuzzleResponse> {
    return this.source.transaction(async (manager) => {
      const [{ date }] = (await manager.query(
        `SELECT ${TODAY}::text AS date`,
      )) as { date: string }[];
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext($1))`,
        [`daily-puzzle:${date}`],
      );
      let daily = await manager.getRepository(DailyPuzzle).findOneBy({ date });
      if (!daily) {
        // Rotate through never-used, then least-recently-used puzzles. New imports
        // cannot change an assignment that was already persisted for this date.
        const [candidate] = (await manager.query(`SELECT p.id FROM puzzles p
          LEFT JOIN daily_puzzles d ON d."puzzleId" = p.id
          WHERE p."validatedAt" IS NOT NULL AND p.themes IS NOT NULL
          GROUP BY p.id ORDER BY max(d.date) ASC NULLS FIRST, p.id ASC LIMIT 1`)) as {
          id: string;
        }[];
        if (!candidate)
          puzzleError(
            503,
            'PUZZLE_CATALOG_EMPTY',
            'No validated puzzles are available.',
          );
        daily = await manager
          .getRepository(DailyPuzzle)
          .save({ date, puzzleId: candidate.id });
      }
      const puzzle = await manager
        .getRepository(Puzzle)
        .findOneByOrFail({ id: daily.puzzleId });
      return toDailyPuzzleResponse(daily, puzzle);
    });
  }

  async start(
    userId: string,
    puzzleId: string,
  ): Promise<PuzzleSessionResponse> {
    if (!(await this.source.getRepository(User).existsBy({ id: userId }))) {
      puzzleError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    const puzzle = await this.puzzle(puzzleId, true);
    const attempt = await this.source.transaction(async (manager) => {
      // Serialized with a solve of the same puzzle: a solve counts as a first try
      // only if no other attempt exists when it commits.
      await this.lockPuzzle(manager, userId, puzzleId);
      return manager.getRepository(PuzzleAttempt).save({
        userId,
        puzzleId,
        currentFen: puzzle.fen,
        moves: [],
        solved: false,
        attempts: 0,
        duration: 0,
        version: 0,
        mistakes: 0,
        hintUsed: false,
        revealed: false,
      });
    });
    return this.present(attempt, await this.practice(attempt));
  }

  async state(
    userId: string,
    attemptId: string,
  ): Promise<PuzzleSessionResponse> {
    const attempt = await this.attempt(userId, attemptId);
    return this.present(attempt, await this.practice(attempt));
  }

  /** A published puzzle (today's or an earlier day's), without its solution. */
  async published(puzzleId: string): Promise<DailyPuzzleResponse> {
    const [row] = (await this.source.query(
      `SELECT max(date)::text AS date FROM daily_puzzles
       WHERE "puzzleId" = $1 AND date <= ${TODAY}`,
      [puzzleId],
    )) as { date: string | null }[];
    if (!row?.date) this.unpublished();
    const puzzle = await this.puzzle(puzzleId);
    return toDailyPuzzleResponse(
      { date: row.date, puzzleId } as DailyPuzzle,
      puzzle,
    );
  }

  /** Earlier days' puzzles, newest first, with how the player did on each. */
  async archive(
    userId: string,
    pagination: Pagination,
  ): Promise<PuzzleArchiveResponse> {
    const [items, [{ total }]] = (await Promise.all([
      this.source.query(
        `SELECT d.date::text AS date, p.id, p.rating, p.themes,
           (SELECT CASE
              WHEN count(*) = 0 THEN NULL
              WHEN bool_or(a.solved) THEN 'SOLVED'
              WHEN bool_and(a.mistakes >= ${MAX_MISTAKES} OR a.revealed) THEN 'FAILED'
              ELSE 'STARTED' END
            FROM puzzle_attempts a WHERE a."userId" = $1 AND a."puzzleId" = p.id) AS status
         FROM daily_puzzles d JOIN puzzles p ON p.id = d."puzzleId"
         WHERE d.date < ${TODAY} AND p."validatedAt" IS NOT NULL AND p.themes IS NOT NULL
         ORDER BY d.date DESC LIMIT $2 OFFSET $3`,
        [userId, pagination.limit, pagination.offset],
      ),
      this.source.query(
        `SELECT count(*)::int AS total FROM daily_puzzles d JOIN puzzles p ON p.id = d."puzzleId"
         WHERE d.date < ${TODAY} AND p."validatedAt" IS NOT NULL AND p.themes IS NOT NULL`,
      ),
    ])) as [PuzzleArchiveResponse['items'], { total: number }[]];
    return { items, total };
  }

  /** The player's latest attempt at this puzzle, to resume it on any device. */
  async progress(
    userId: string,
    puzzleId: string,
  ): Promise<PuzzleProgressResponse> {
    const latest = await this.source
      .getRepository(PuzzleAttempt)
      .createQueryBuilder('a')
      .where('a."userId" = :userId AND a."puzzleId" = :puzzleId', {
        userId,
        puzzleId,
      })
      .orderBy('a."createdAt"', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .getOne();
    const [{ rewarded }] = (await this.source.query(
      `SELECT EXISTS (SELECT 1 FROM xp_events WHERE "userId" = $1 AND source = 'PUZZLE' AND "refId" = $2::text) AS rewarded`,
      [userId, puzzleId],
    )) as { rewarded: boolean }[];
    const usable =
      latest &&
      latest.currentFen !== null &&
      latest.attempts !== null &&
      latest.duration !== null;
    return {
      attempt: usable
        ? this.present(latest, await this.practice(latest))
        : null,
      rewarded,
    };
  }

  /** The square of the piece to move next. The attempt then earns half the XP. */
  async hint(
    userId: string,
    attemptId: string,
  ): Promise<PuzzleSessionResponse & { hint: string }> {
    const attempt = await this.attempt(userId, attemptId);
    this.assertPlayable(attempt);
    const puzzle = await this.puzzle(attempt.puzzleId);
    const next = puzzle.solution[attempt.moves.length];
    if (!attempt.hintUsed) {
      // Only while the attempt is still playable; the new version tells another
      // tab that the attempt now earns half the XP.
      const result = await this.source
        .getRepository(PuzzleAttempt)
        .createQueryBuilder()
        .update()
        .set({ hintUsed: true, version: () => 'version + 1' })
        .where(
          'id = :id AND "userId" = :userId AND version = :version AND NOT solved AND NOT revealed',
          { id: attempt.id, userId, version: attempt.version },
        )
        .execute();
      if (!result.affected) this.stale();
      attempt.version += 1;
    }
    attempt.hintUsed = true;
    return {
      ...this.present(attempt, await this.practice(attempt)),
      hint: next.slice(0, 2),
    };
  }

  /** The whole line, from the published position. An unsolved attempt ends there. */
  async solution(
    userId: string,
    attemptId: string,
  ): Promise<PuzzleSessionResponse & { solution: string[] }> {
    const attempt = await this.attempt(userId, attemptId);
    const puzzle = await this.puzzle(attempt.puzzleId);
    if (!attempt.solved && !attempt.revealed) {
      await this.source
        .getRepository(PuzzleAttempt)
        .update({ id: attempt.id, userId }, { revealed: true });
      attempt.revealed = true;
    }
    return {
      ...this.present(attempt, await this.practice(attempt)),
      solution: [...puzzle.solution],
    };
  }

  async play(
    userId: string,
    attemptId: string,
    move: string,
    version: number,
  ): Promise<PuzzleTurnResponse> {
    if (
      !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move) ||
      !Number.isSafeInteger(version) ||
      version < 0
    ) {
      puzzleError(
        400,
        'INVALID_PUZZLE_MOVE',
        'Expected a UCI move and a non-negative version.',
      );
    }
    const attempt = await this.attempt(userId, attemptId);
    // A finished attempt says so, whatever version the client holds.
    this.assertPlayable(attempt);
    if (attempt.version !== version) this.stale();
    const puzzle = await this.puzzle(attempt.puzzleId);
    const history = [...attempt.moves];
    const before = await this.rules.position(puzzle.fen, history);
    if (
      before.fen !== attempt.currentFen ||
      history.length % 2 !== 0 ||
      history.length >= puzzle.solution.length
    ) {
      puzzleError(
        500,
        'INVALID_PUZZLE_STATE',
        'The stored puzzle attempt is inconsistent.',
      );
    }
    let correct = false;
    let opponentMove: string | undefined;
    let after = before;
    if (before.status === 'ongoing' && before.legalMoves.includes(move)) {
      const candidate = await this.rules.position(puzzle.fen, [
        ...history,
        move,
      ]);
      // Lichess mate-in-one puzzles may have more than one winning move.
      const alternativeMate =
        puzzle.themes?.includes('MATE_IN_ONE') &&
        history.length === 0 &&
        candidate.checkmate &&
        candidate.winner === before.turn;
      correct =
        move === puzzle.solution[history.length] || Boolean(alternativeMate);
      if (correct) {
        history.push(move);
        after = candidate;
        if (history.length < puzzle.solution.length) {
          opponentMove = puzzle.solution[history.length];
          if (
            after.status !== 'ongoing' ||
            !after.legalMoves.includes(opponentMove)
          ) {
            puzzleError(
              500,
              'INVALID_PUZZLE_STATE',
              'The stored puzzle continuation is inconsistent.',
            );
          }
          history.push(opponentMove);
          after = await this.rules.position(puzzle.fen, history);
        }
      }
    }
    const completed = correct && history.length === puzzle.solution.length;
    // Network calls above hold no DB transaction, row lock or pool connection.
    // CAS prevents duplicate requests and simultaneous tabs from advancing twice.
    let award: { change: XpChange; reward: PuzzleReward } | null = null;
    const saved = await this.source.transaction(async (manager) => {
      if (completed) await this.lockPuzzle(manager, userId, attempt.puzzleId);
      const result = await manager
        .getRepository(PuzzleAttempt)
        .createQueryBuilder()
        .update()
        .set({
          currentFen: after.fen,
          moves: history,
          solved: completed,
          attempts: (attempt.attempts ?? 0) + 1,
          mistakes: attempt.mistakes + (correct ? 0 : 1),
          version: version + 1,
          duration: () =>
            `LEAST(2147483647, GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - "createdAt")) * 1000)))::integer`,
        })
        .where(
          'id = :id AND "userId" = :userId AND version = :version AND NOT revealed',
          { id: attemptId, userId, version },
        )
        .returning('*')
        .execute();
      if (!result.affected) this.stale();
      const row = manager
        .getRepository(PuzzleAttempt)
        .create(result.raw[0] as PuzzleAttempt);
      if (completed && this.progression)
        award = await this.progression.awardPuzzle(
          manager,
          userId,
          row.puzzleId,
          row.hintUsed,
        );
      return row;
    });
    const settled = award as { change: XpChange; reward: PuzzleReward } | null;
    if (settled) await this.progression?.settle([settled.change]);
    return {
      ...this.present(saved, await this.practice(saved)),
      correct,
      completed,
      nextPosition: saved.currentFen!,
      ...(opponentMove ? { opponentMove } : {}),
      ...(settled ? { reward: settled.reward } : {}),
    };
  }

  /**
   * Spec §30 `POST /puzzles/:id/move`: plays on the caller's latest unfinished attempt
   * at this puzzle, starting one when there is none. The attempt routes stay the way
   * to resume a specific attempt with its version.
   */
  async move(
    userId: string,
    puzzleId: string,
    move: string,
  ): Promise<PuzzleTurnResponse> {
    const latest = await this.source
      .getRepository(PuzzleAttempt)
      .createQueryBuilder('a')
      .where('a."userId" = :userId AND a."puzzleId" = :puzzleId', {
        userId,
        puzzleId,
      })
      .andWhere('a.solved = false AND a."currentFen" IS NOT NULL')
      .andWhere('a.mistakes < :max AND NOT a.revealed', { max: MAX_MISTAKES })
      .andWhere('a.attempts IS NOT NULL AND a.duration IS NOT NULL')
      .orderBy('a."createdAt"', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .getOne();
    const attempt = latest
      ? { attemptId: latest.id, version: latest.version }
      : await this.start(userId, puzzleId);
    return this.play(userId, attempt.attemptId, move, attempt.version);
  }

  /**
   * With `published`, only a puzzle that was the daily puzzle of today or an earlier day:
   * the rest of the catalogue is not played before its day comes.
   */
  private async puzzle(id: string, published = false): Promise<Puzzle> {
    const query = this.source
      .getRepository(Puzzle)
      .createQueryBuilder('p')
      .addSelect('p.solution')
      .where('p.id = :id', { id });
    if (published)
      query.andWhere(
        `EXISTS (SELECT 1 FROM daily_puzzles d WHERE d."puzzleId" = p.id AND d.date <= ${TODAY})`,
      );
    const puzzle = await query.getOne();
    if (!puzzle || !puzzle.validatedAt || puzzle.themes === null) {
      if (published) this.unpublished();
      puzzleError(404, 'PUZZLE_NOT_FOUND', 'Validated puzzle not found.');
    }
    return puzzle;
  }

  private unpublished(): never {
    puzzleError(
      404,
      'PUZZLE_NOT_FOUND',
      'This puzzle is not available: play the daily puzzle or one from the archive.',
    );
  }

  private assertPlayable(attempt: PuzzleAttempt): void {
    if (attempt.solved)
      puzzleError(
        409,
        'PUZZLE_ALREADY_COMPLETED',
        'This attempt is already completed.',
      );
    if (attempt.revealed || attempt.mistakes >= MAX_MISTAKES)
      puzzleError(
        409,
        'PUZZLE_ATTEMPT_FAILED',
        'This attempt is over. Start a new one to practise.',
      );
  }

  private async lockPuzzle(
    manager: EntityManager,
    userId: string,
    puzzleId: string,
  ): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext($1))`,
      [`puzzle-attempts:${userId}:${puzzleId}`],
    );
  }

  /** Any attempt but the player's only one is practice: it earns nothing. */
  private async practice(attempt: PuzzleAttempt): Promise<boolean> {
    const [{ count }] = (await this.source.query(
      `SELECT count(*)::int AS count FROM puzzle_attempts WHERE "userId" = $1 AND "puzzleId" = $2`,
      [attempt.userId, attempt.puzzleId],
    )) as { count: number }[];
    return count > 1;
  }

  private async attempt(userId: string, id: string): Promise<PuzzleAttempt> {
    const attempt = await this.source
      .getRepository(PuzzleAttempt)
      .findOneBy({ id, userId });
    if (!attempt)
      puzzleError(404, 'PUZZLE_ATTEMPT_NOT_FOUND', 'Puzzle attempt not found.');
    if (
      attempt.currentFen === null ||
      attempt.attempts === null ||
      attempt.duration === null
    ) {
      puzzleError(
        409,
        'LEGACY_PUZZLE_ATTEMPT',
        'Start a new attempt to play this puzzle.',
      );
    }
    return attempt;
  }

  private stale(): never {
    puzzleError(
      409,
      'PUZZLE_STALE_VERSION',
      'Reload the attempt before submitting another move.',
    );
  }

  private present(
    attempt: PuzzleAttempt,
    practice: boolean,
  ): PuzzleSessionResponse {
    return {
      attemptId: attempt.id,
      puzzleId: attempt.puzzleId,
      fen: attempt.currentFen!,
      ply: attempt.moves.length,
      version: attempt.version,
      completed: attempt.solved,
      attempts: attempt.attempts!,
      duration: attempt.duration!,
      mistakes: attempt.mistakes,
      mistakesLeft: Math.max(0, MAX_MISTAKES - attempt.mistakes),
      failed:
        !attempt.solved &&
        (attempt.revealed || attempt.mistakes >= MAX_MISTAKES),
      hintUsed: attempt.hintUsed,
      revealed: attempt.revealed,
      practice,
    };
  }
}
