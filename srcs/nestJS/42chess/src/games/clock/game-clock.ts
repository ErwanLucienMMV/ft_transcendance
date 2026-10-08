export interface TimeControl {
  readonly initialTime: number;
  readonly increment: number;
}

export type PlayerColor = 'WHITE' | 'BLACK';
export type ClockStatus = 'WAITING' | 'RUNNING' | 'STOPPED' | 'EXPIRED';

export interface ClockSnapshot {
  readonly white: number;
  readonly black: number;
  readonly activeColor: PlayerColor | null;
  readonly status: ClockStatus;
  readonly expiredColor: PlayerColor | null;
}

export type ClockErrorCode =
  | 'INVALID_TIME_CONTROL'
  | 'INVALID_TIMESTAMP'
  | 'CLOCK_NOT_WAITING'
  | 'CLOCK_NOT_RUNNING'
  | 'WRONG_TURN'
  | 'TIME_OVERFLOW';

export class ClockError extends Error {
  constructor(
    readonly code: ClockErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ClockError';
  }
}

/** Pure server-side clock calculations. All times are integer milliseconds. */
export class GameClock {
  readonly #timeControl: TimeControl;
  #state: ClockSnapshot;
  #lastUpdatedAt = 0;
  #lastObservedAt = -1;

  constructor(timeControl: TimeControl) {
    if (
      !Number.isSafeInteger(timeControl.initialTime) ||
      timeControl.initialTime <= 0 ||
      !Number.isSafeInteger(timeControl.increment) ||
      timeControl.increment < 0
    ) {
      throw new ClockError(
        'INVALID_TIME_CONTROL',
        'Initial time must be positive and increment non-negative, in safe integer milliseconds.',
      );
    }
    this.#timeControl = Object.freeze({ ...timeControl });
    this.#state = Object.freeze({
      white: timeControl.initialTime,
      black: timeControl.initialTime,
      activeColor: null,
      status: 'WAITING',
      expiredColor: null,
    });
  }

  get timeControl(): TimeControl {
    return this.#timeControl;
  }

  /** Call once when the game becomes ACTIVE, using a server timestamp. */
  start(now: number): ClockSnapshot {
    if (this.#state.status !== 'WAITING') {
      throw new ClockError(
        'CLOCK_NOT_WAITING',
        'The clock can only start once.',
      );
    }
    return this.#commit(
      { ...this.#project(now), status: 'RUNNING', activeColor: 'WHITE' },
      now,
    );
  }

  /** Reading settles elapsed time and latches expiry; it never grants increment. */
  getSnapshot(now: number): ClockSnapshot {
    return this.#commit(this.#project(now), now);
  }

  /** Call only for a move already authorized and accepted by the game service. */
  completeMove(player: PlayerColor, now: number): ClockSnapshot {
    if (this.#state.status !== 'RUNNING') {
      throw new ClockError(
        'CLOCK_NOT_RUNNING',
        'A move requires a running clock.',
      );
    }
    if (player !== this.#state.activeColor) {
      throw new ClockError(
        'WRONG_TURN',
        'Only the active player can complete a move.',
      );
    }

    const projected = this.#project(now);
    // At the exact deadline, increment cannot rescue the move.
    if (projected.status === 'EXPIRED') return this.#commit(projected, now);

    const balance = player === 'WHITE' ? 'white' : 'black';
    const remaining = projected[balance] + this.#timeControl.increment;
    if (!Number.isSafeInteger(remaining)) {
      throw new ClockError(
        'TIME_OVERFLOW',
        'The clock balance exceeds safe integer milliseconds.',
      );
    }
    return this.#commit(
      {
        ...projected,
        [balance]: remaining,
        activeColor: player === 'WHITE' ? 'BLACK' : 'WHITE',
      },
      now,
    );
  }

  /** Freeze both clocks when the game ends or a waiting game is cancelled. */
  stop(now: number): ClockSnapshot {
    const projected = this.#project(now);
    if (projected.status === 'EXPIRED' || projected.status === 'STOPPED') {
      return this.#commit(projected, now);
    }
    return this.#commit(
      { ...projected, status: 'STOPPED', activeColor: null },
      now,
    );
  }

  #project(now: number): ClockSnapshot {
    if (!Number.isSafeInteger(now) || now < 0 || now < this.#lastObservedAt) {
      throw new ClockError(
        'INVALID_TIMESTAMP',
        'Server timestamps must be non-decreasing, non-negative safe integer milliseconds.',
      );
    }
    const active = this.#state.activeColor;
    if (this.#state.status !== 'RUNNING' || active === null) return this.#state;

    const balance = active === 'WHITE' ? 'white' : 'black';
    const remaining = Math.max(
      0,
      this.#state[balance] - (now - this.#lastUpdatedAt),
    );
    const projected: ClockSnapshot = { ...this.#state, [balance]: remaining };
    return remaining === 0
      ? {
          ...projected,
          status: 'EXPIRED',
          activeColor: null,
          expiredColor: active,
        }
      : projected;
  }

  #commit(state: ClockSnapshot, now: number): ClockSnapshot {
    this.#state = Object.freeze(state);
    this.#lastUpdatedAt = now;
    this.#lastObservedAt = now;
    return this.#state;
  }
}
