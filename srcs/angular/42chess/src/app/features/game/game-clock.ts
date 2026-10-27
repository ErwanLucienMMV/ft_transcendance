import { Component, computed, input } from '@angular/core';

/** Formats a clock; under ten seconds tenths matter, so they are shown. */
export function formatClock(ms: number): string {
  const safe = Math.max(0, ms);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const base = `${minutes}:${String(seconds).padStart(2, '0')}`;
  return safe < 10_000 ? `${base}.${Math.floor((safe % 1000) / 100)}` : base;
}

@Component({
  selector: 'app-game-clock',
  template: `
    <div
      class="clock"
      [class.running]="running()"
      [class.low]="low()"
      role="timer"
      [attr.aria-label]="label() + ' clock, ' + spoken()"
    >
      {{ text() }}
    </div>
  `,
  styles: `
    .clock {
      min-width: 6.5ch;
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      font:
        600 1.4rem/1.2 ui-monospace,
        monospace;
      font-variant-numeric: tabular-nums;
      text-align: right;
      background: var(--field);
      color: var(--muted);
    }
    .running {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--accent-ink);
    }
    .low.running {
      background: var(--error);
      border-color: var(--error);
    }
  `,
})
export class GameClock {
  /** Remaining milliseconds, or null when the server has no clock for this game. */
  readonly remaining = input.required<number | null>();
  readonly running = input(false);
  readonly label = input.required<string>();

  readonly text = computed(() => {
    const ms = this.remaining();
    return ms === null ? '--:--' : formatClock(ms);
  });
  readonly low = computed(() => (this.remaining() ?? Infinity) < 20_000);
  readonly spoken = computed(() => {
    const ms = this.remaining();
    if (ms === null) return 'no clock';
    const total = Math.ceil(Math.max(0, ms) / 1000);
    return `${Math.floor(total / 60)} minutes ${total % 60} seconds`;
  });
}
