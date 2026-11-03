import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map, Observable, of, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import type { PlayerColor } from '../../core/realtime/game-realtime';
import { BoardMove, ChessBoard, fenAfter, moveUci } from '../../shared/chess/chess-board';
import { formatClock } from '../game/game-clock';
import { ProgressionApi } from '../progression/progression-api';
import { DailyPuzzle, PuzzleAttempt, PuzzleReward, PuzzlesApi, PuzzleTurn } from './puzzles-api';

const THEMES: Record<string, string> = {
  CHECK: 'Check',
  CHECKMATE: 'Checkmate',
  FORK: 'Fork',
  PIN: 'Pin',
  SKEWER: 'Skewer',
  DISCOVERED_ATTACK: 'Discovered attack',
  MATE_IN_ONE: 'Mate in one',
  MATE_IN_TWO: 'Mate in two',
};
const ERRORS: Record<string, string> = {
  PUZZLE_CATALOG_EMPTY: 'No puzzle is available today.',
  PUZZLE_ENGINE_UNAVAILABLE: 'The puzzle checker is unavailable. Your progress is kept; try again.',
  LEGACY_PUZZLE_ATTEMPT: 'This attempt can no longer be resumed. Start again.',
  PUZZLE_ATTEMPT_FAILED: 'This attempt is over. Start a new one to practise.',
  PUZZLE_NOT_FOUND: 'This puzzle is not available. Play the daily puzzle or one from the archive.',
};

/** A UCI move as the board takes it. */
export function boardMove(uci: string): BoardMove {
  const promotion = { q: 'QUEEN', r: 'ROOK', b: 'BISHOP', n: 'KNIGHT' }[uci[4] ?? ''] as
    BoardMove['promotion'] | undefined;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: promotion ?? null };
}

/**
 * The daily puzzle (`/puzzle`) or an earlier day's (`/puzzle/:id`). The server checks every move
 * against a solution the browser never sees, plays the opponent reply and keeps the progress, so
 * the latest attempt resumes on any device. Three wrong moves end an attempt; a hint names the
 * piece to move; the solution can be shown and replayed move by move.
 */
@Component({
  selector: 'app-puzzle-page',
  imports: [ChessBoard, RouterLink],
  templateUrl: './puzzle-page.html',
  styleUrl: './puzzle-page.css',
})
export class PuzzlePage {
  private readonly api = inject(PuzzlesApi);
  private readonly progression = inject(ProgressionApi);
  readonly session = inject(AuthSession);

  /** Null on the daily puzzle page. */
  readonly puzzleId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id'))),
    { initialValue: null },
  );
  readonly daily = signal<DailyPuzzle | null>(null);
  readonly attempt = signal<PuzzleAttempt | null>(null);
  readonly rewarded = signal(false);
  readonly reward = signal<PuzzleReward | null>(null);
  readonly hint = signal<string | null>(null);
  readonly solution = signal<string[] | null>(null);
  /** Moves of the shown solution played on the board. */
  readonly step = signal(0);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly sending = signal<BoardMove | null>(null);
  readonly feedback = signal<'correct' | 'incorrect' | null>(null);
  readonly lastMove = signal<{ from: string; to: string } | null>(null);
  readonly error = signal<string | null>(null);
  /** The signed-in player's current daily streak. */
  readonly streak = signal<number | null>(null);

  readonly isToday = computed(() => this.puzzleId() === null);
  /** The solver plays the side to move in the published position, for the whole puzzle. */
  readonly color = computed<PlayerColor>(() =>
    this.daily()?.fen.split(' ')[1] === 'b' ? 'BLACK' : 'WHITE',
  );
  readonly fen = computed(() => {
    const line = this.solution();
    const start = this.daily()?.fen ?? '';
    if (line && start) return this.replay(start, line.slice(0, this.step()));
    const confirmed = this.attempt()?.fen ?? start;
    const sending = this.sending();
    if (!sending || !confirmed) return confirmed;
    try {
      return fenAfter(confirmed, sending);
    } catch {
      return confirmed;
    }
  });
  readonly boardMove = computed(() => {
    const line = this.solution();
    if (line) {
      const shown = line[this.step() - 1];
      return shown ? { from: shown.slice(0, 2), to: shown.slice(2, 4) } : null;
    }
    return this.sending() ?? this.lastMove();
  });
  readonly solved = computed(() => !!this.attempt()?.completed);
  readonly failed = computed(() => !!this.attempt()?.failed);
  readonly over = computed(() => this.solved() || this.failed());
  readonly canMove = computed(
    () =>
      this.session.authenticated() &&
      !!this.daily() &&
      !this.over() &&
      !this.solution() &&
      !this.sending(),
  );
  readonly themes = computed(() => (this.daily()?.themes ?? []).map((t) => THEMES[t] ?? t));
  readonly prompt = computed(() => {
    if (this.solved()) return 'Puzzle solved!';
    if (this.attempt()?.revealed) return 'Solution shown.';
    if (this.failed()) return 'Out of tries.';
    if (this.sending()) return 'Checking your move…';
    if (this.feedback() === 'incorrect') return 'Not the best move. Try again.';
    if (this.feedback() === 'correct') return 'Correct! Keep going.';
    return `Find the best move for ${this.color() === 'WHITE' ? 'White' : 'Black'}.`;
  });
  readonly mistakes = computed(() => this.attempt()?.mistakes ?? 0);
  readonly mistakesLeft = computed(() => this.attempt()?.mistakesLeft ?? 3);
  readonly time = computed(() => formatClock(this.attempt()?.duration ?? 0));
  /** Whether this attempt can still earn XP: the first and only one at the puzzle. */
  readonly scored = computed(() => !this.rewarded() && !this.attempt()?.practice);

  constructor() {
    effect(() => {
      const id = this.puzzleId();
      untracked(() => this.load(id));
    });
    effect(() => {
      const user = this.session.user()?.id;
      untracked(() => {
        this.streak.set(null);
        if (user)
          this.progression.stats(user).subscribe({
            next: (stats) => this.streak.set(stats.puzzles.streak),
            error: () => this.streak.set(null),
          });
      });
    });
    effect(() => {
      // Resume the latest attempt once both the puzzle and the account are known.
      const puzzle = this.daily();
      const user = this.session.user()?.id ?? null;
      untracked(() => this.resume(puzzle, user));
    });
  }

  play(move: BoardMove): void {
    const puzzle = this.daily();
    if (!puzzle || !this.session.user() || !this.canMove()) return;
    this.sending.set(move);
    this.error.set(null);
    const current = this.attempt();
    const attempt$: Observable<PuzzleAttempt> = current ? of(current) : this.api.start(puzzle.id);
    attempt$
      .pipe(
        switchMap((attempt) => {
          if (!current) this.attempt.set(attempt);
          return this.api.play(attempt.attemptId, moveUci(move), attempt.version);
        }),
      )
      .subscribe({
        next: (turn) => this.answer(turn, move),
        error: (error: unknown) => {
          this.sending.set(null);
          if (error instanceof ApiError && error.statusCode === 409) {
            this.reload();
            return;
          }
          this.error.set(this.message(error, 'Your move could not be checked.'));
        },
      });
  }

  /** Points out the piece to move. The attempt then earns half the XP. */
  askHint(): void {
    const attempt = this.attempt();
    const puzzle = this.daily();
    if (!puzzle || this.busy() || !this.canMove()) return;
    this.busy.set(true);
    this.error.set(null);
    (attempt ? of(attempt) : this.api.start(puzzle.id))
      .pipe(
        switchMap((current) => {
          if (!attempt) this.attempt.set(current);
          return this.api.hint(current.attemptId);
        }),
      )
      .subscribe({
        next: ({ hint, ...fresh }) => {
          this.busy.set(false);
          this.attempt.set(fresh);
          this.hint.set(hint);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(this.message(error, 'No hint is available right now.'));
        },
      });
  }

  /** Shows the whole line, which ends an unsolved attempt. */
  showSolution(): void {
    const attempt = this.attempt();
    const puzzle = this.daily();
    // Not while a move is on its way: revealing first would discard a winning move.
    if (!puzzle || this.busy() || this.sending() || !this.session.user()) return;
    this.busy.set(true);
    this.error.set(null);
    (attempt ? of(attempt) : this.api.start(puzzle.id))
      .pipe(
        switchMap((current) => {
          if (!attempt) this.attempt.set(current);
          return this.api.solution(current.attemptId);
        }),
      )
      .subscribe({
        next: ({ solution, ...fresh }) => {
          this.busy.set(false);
          this.attempt.set(fresh);
          this.hint.set(null);
          this.feedback.set(null);
          this.solution.set(solution);
          this.step.set(solution.length);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.error.set(this.message(error, 'The solution could not be loaded.'));
        },
      });
  }

  stepTo(step: number): void {
    const line = this.solution();
    if (line) this.step.set(Math.max(0, Math.min(line.length, step)));
  }

  /** A new attempt starts from the published position. It is practice: it earns nothing. */
  restart(): void {
    const puzzle = this.daily();
    if (!puzzle || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.start(puzzle.id).subscribe({
      next: (attempt) => {
        this.busy.set(false);
        this.reset();
        this.attempt.set(attempt);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(this.message(error, 'A new attempt could not be started.'));
      },
    });
  }

  private answer(turn: PuzzleTurn, move: BoardMove): void {
    this.sending.set(null);
    this.attempt.set(turn);
    this.feedback.set(turn.correct ? 'correct' : 'incorrect');
    if (turn.reward) {
      this.reward.set(turn.reward);
      this.rewarded.set(true);
      if (turn.reward.streak !== null) this.streak.set(turn.reward.streak);
    }
    if (!turn.correct) return;
    this.hint.set(null);
    const reply = turn.opponentMove;
    this.lastMove.set(reply ? { from: reply.slice(0, 2), to: reply.slice(2, 4) } : move);
  }

  private load(id: string | null): void {
    this.daily.set(null);
    this.attempt.set(null);
    this.rewarded.set(false);
    this.reset();
    this.loading.set(true);
    this.error.set(null);
    (id ? this.api.published(id) : this.api.daily()).subscribe({
      next: (puzzle) => {
        this.daily.set(puzzle);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(this.message(error, 'The puzzle could not be loaded.'));
      },
    });
  }

  private resume(puzzle: DailyPuzzle | null, userId: string | null): void {
    if (!userId) {
      // Signed out: nothing of the previous account's attempt stays on the page.
      this.attempt.set(null);
      this.rewarded.set(false);
      this.reset();
      return;
    }
    if (!puzzle) return;
    this.api.progress(puzzle.id).subscribe({
      next: ({ attempt, rewarded }) => {
        if (this.daily()?.id !== puzzle.id) return;
        this.rewarded.set(rewarded);
        if (attempt && attempt.attemptId !== this.attempt()?.attemptId) this.attempt.set(attempt);
      },
      error: () => {
        // The puzzle stays playable: the first move starts an attempt.
      },
    });
  }

  /** Another tab moved first or the request was sent twice: the server state wins. */
  private reload(): void {
    const attempt = this.attempt();
    if (!attempt) return;
    this.api.attempt(attempt.attemptId).subscribe({
      next: (fresh) => {
        this.attempt.set(fresh);
        this.feedback.set(null);
        this.error.set(
          fresh.failed
            ? ERRORS['PUZZLE_ATTEMPT_FAILED']
            : 'Your progress was updated from another tab.',
        );
      },
      error: (error: unknown) => this.error.set(this.message(error, 'Reload the page.')),
    });
  }

  private reset(): void {
    this.reward.set(null);
    this.hint.set(null);
    this.solution.set(null);
    this.step.set(0);
    this.feedback.set(null);
    this.lastMove.set(null);
    this.sending.set(null);
  }

  private replay(fen: string, moves: string[]): string {
    try {
      return moves.reduce((position, uci) => fenAfter(position, boardMove(uci)), fen);
    } catch {
      return fen;
    }
  }

  private message(error: unknown, fallback: string): string {
    if (!(error instanceof ApiError)) return fallback;
    return ERRORS[error.code] ?? (error.statusCode < 500 ? error.message : fallback);
  }
}
