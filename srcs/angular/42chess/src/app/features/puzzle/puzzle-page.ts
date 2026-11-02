import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, of, switchMap } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { AuthSession } from '../../core/auth/auth-session';
import type { PlayerColor } from '../../core/realtime/game-realtime';
import { BoardMove, ChessBoard, fenAfter, moveUci } from '../../shared/chess/chess-board';
import { formatClock } from '../game/game-clock';
import { DailyPuzzle, PuzzleAttempt, PuzzleProgress, PuzzlesApi, PuzzleTurn } from './puzzles-api';

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
};

/**
 * Daily puzzle. The server checks every move against a solution the browser never sees,
 * plays the opponent reply and keeps the progress, the tries and the time.
 */
@Component({
  selector: 'app-puzzle-page',
  imports: [ChessBoard, RouterLink],
  templateUrl: './puzzle-page.html',
  styleUrl: './puzzle-page.css',
})
export class PuzzlePage {
  private readonly api = inject(PuzzlesApi);
  private readonly progress = inject(PuzzleProgress);
  readonly session = inject(AuthSession);

  readonly daily = signal<DailyPuzzle | null>(null);
  readonly attempt = signal<PuzzleAttempt | null>(null);
  readonly loading = signal(true);
  readonly sending = signal<BoardMove | null>(null);
  readonly feedback = signal<'correct' | 'incorrect' | null>(null);
  readonly lastMove = signal<{ from: string; to: string } | null>(null);
  readonly error = signal<string | null>(null);

  /** The solver plays the side to move in the published position, for the whole puzzle. */
  readonly color = computed<PlayerColor>(() =>
    this.daily()?.fen.split(' ')[1] === 'b' ? 'BLACK' : 'WHITE',
  );
  readonly fen = computed(() => {
    const confirmed = this.attempt()?.fen ?? this.daily()?.fen ?? '';
    const sending = this.sending();
    if (!sending || !confirmed) return confirmed;
    try {
      return fenAfter(confirmed, sending);
    } catch {
      return confirmed;
    }
  });
  readonly solved = computed(() => !!this.attempt()?.completed);
  readonly canMove = computed(
    () => this.session.authenticated() && !!this.daily() && !this.solved() && !this.sending(),
  );
  readonly themes = computed(() => (this.daily()?.themes ?? []).map((t) => THEMES[t] ?? t));
  readonly prompt = computed(() => {
    if (this.solved()) return 'Puzzle solved!';
    if (this.sending()) return 'Checking your move…';
    if (this.feedback() === 'incorrect') return 'Not the best move. Try again.';
    if (this.feedback() === 'correct') return 'Correct! Keep going.';
    return `Find the best move for ${this.color() === 'WHITE' ? 'White' : 'Black'}.`;
  });
  /** Tries that were not accepted: every submission minus the solver's accepted moves. */
  readonly mistakes = computed(() => {
    const attempt = this.attempt();
    return attempt ? Math.max(0, attempt.attempts - Math.ceil(attempt.ply / 2)) : 0;
  });
  readonly time = computed(() => formatClock(this.attempt()?.duration ?? 0));

  constructor() {
    this.api.daily().subscribe({
      next: (daily) => {
        this.daily.set(daily);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(this.message(error, 'The puzzle could not be loaded.'));
      },
    });
    effect(() => {
      // Resume the attempt of this tab once both the puzzle and the account are known.
      const daily = this.daily();
      const user = this.session.user();
      untracked(() => this.resume(daily, user?.id ?? null));
    });
  }

  play(move: BoardMove): void {
    const daily = this.daily();
    const user = this.session.user();
    if (!daily || !user || !this.canMove()) return;
    this.sending.set(move);
    this.error.set(null);
    const current = this.attempt();
    const attempt$: Observable<PuzzleAttempt> = current ? of(current) : this.api.start(daily.id);
    attempt$
      .pipe(
        switchMap((attempt) => {
          if (!current) {
            this.progress.remember(user.id, daily.id, attempt.attemptId);
            this.attempt.set(attempt);
          }
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

  /** A new attempt starts from the published position with fresh counters. */
  restart(): void {
    this.progress.forget();
    this.attempt.set(null);
    this.feedback.set(null);
    this.lastMove.set(null);
    this.error.set(null);
  }

  private answer(turn: PuzzleTurn, move: BoardMove): void {
    this.sending.set(null);
    this.attempt.set(turn);
    this.feedback.set(turn.correct ? 'correct' : 'incorrect');
    if (!turn.correct) return;
    const reply = turn.opponentMove;
    this.lastMove.set(reply ? { from: reply.slice(0, 2), to: reply.slice(2, 4) } : move);
  }

  private resume(daily: DailyPuzzle | null, userId: string | null): void {
    if (!userId) {
      // Signed out: nothing of the previous account's attempt stays in this tab.
      this.attempt.set(null);
      this.progress.forget();
      return;
    }
    if (!daily) return;
    const attemptId = this.progress.find(userId, daily.id);
    if (!attemptId || this.attempt()?.attemptId === attemptId) return;
    this.api.attempt(attemptId).subscribe({
      next: (attempt) => this.attempt.set(attempt),
      error: () => this.progress.forget(),
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
        this.error.set('Your progress was updated from another tab.');
      },
      error: (error: unknown) => this.error.set(this.message(error, 'Reload the page.')),
    });
  }

  private message(error: unknown, fallback: string): string {
    if (!(error instanceof ApiError)) return fallback;
    return ERRORS[error.code] ?? (error.statusCode < 500 ? error.message : fallback);
  }
}
