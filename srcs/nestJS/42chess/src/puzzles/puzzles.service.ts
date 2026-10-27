import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/user.entity.js';
import { Puzzle } from './puzzles.entity.js';
import { PuzzleAttempt } from './puzzle-attempts.entity.js';
import { DailyPuzzle } from './daily-puzzles.entity.js';
import { PuzzleRulesService } from './puzzle-rules.service.js';
import { toDailyPuzzleResponse } from './puzzle-presenter.js';
import { puzzleError } from './puzzle-errors.js';
import type { DailyPuzzleResponse } from './puzzle.types.js';
import type {
  PuzzleSessionResponse,
  PuzzleTurnResponse,
} from './puzzle-session.types.js';

@Injectable()
export class PuzzlesService {
  constructor(
    private readonly source: DataSource,
    private readonly rules: PuzzleRulesService,
  ) {}

  /** UTC day and transaction lock come from PostgreSQL, shared by every API replica. */
  async daily(): Promise<DailyPuzzleResponse> {
    return this.source.transaction(async (manager) => {
      const [{ date }] = (await manager.query(
        `SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS date`,
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
    const puzzle = await this.puzzle(puzzleId);
    const attempt = await this.source.getRepository(PuzzleAttempt).save({
      userId,
      puzzleId,
      currentFen: puzzle.fen,
      moves: [],
      solved: false,
      attempts: 0,
      duration: 0,
      version: 0,
    });
    return this.present(attempt);
  }

  async state(
    userId: string,
    attemptId: string,
  ): Promise<PuzzleSessionResponse> {
    return this.present(await this.attempt(userId, attemptId));
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
    if (attempt.version !== version) this.stale();
    if (attempt.solved)
      puzzleError(
        409,
        'PUZZLE_ALREADY_COMPLETED',
        'This attempt is already completed.',
      );
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
    const result = await this.source
      .getRepository(PuzzleAttempt)
      .createQueryBuilder()
      .update()
      .set({
        currentFen: after.fen,
        moves: history,
        solved: completed,
        attempts: (attempt.attempts ?? 0) + 1,
        version: version + 1,
        duration: () =>
          `LEAST(2147483647, GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - "createdAt")) * 1000)))::integer`,
      })
      .where('id = :id AND "userId" = :userId AND version = :version', {
        id: attemptId,
        userId,
        version,
      })
      .returning('*')
      .execute();
    if (!result.affected) this.stale();
    const saved = this.source
      .getRepository(PuzzleAttempt)
      .create(result.raw[0] as PuzzleAttempt);
    return {
      ...this.present(saved),
      correct,
      completed,
      nextPosition: saved.currentFen!,
      ...(opponentMove ? { opponentMove } : {}),
    };
  }

  private async puzzle(id: string): Promise<Puzzle> {
    const puzzle = await this.source
      .getRepository(Puzzle)
      .createQueryBuilder('p')
      .addSelect('p.solution')
      .where('p.id = :id', { id })
      .getOne();
    if (!puzzle || !puzzle.validatedAt || puzzle.themes === null) {
      puzzleError(404, 'PUZZLE_NOT_FOUND', 'Validated puzzle not found.');
    }
    return puzzle;
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

  private present(attempt: PuzzleAttempt): PuzzleSessionResponse {
    return {
      attemptId: attempt.id,
      puzzleId: attempt.puzzleId,
      fen: attempt.currentFen!,
      ply: attempt.moves.length,
      version: attempt.version,
      completed: attempt.solved,
      attempts: attempt.attempts!,
      duration: attempt.duration!,
    };
  }
}
