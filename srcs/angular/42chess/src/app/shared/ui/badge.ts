import { Component, input } from '@angular/core';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/** A short label or a count, such as "Rated", "Bot" or the number of unread messages. */
@Component({
  selector: 'app-badge',
  template: `<ng-content />`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 20px;
      height: 20px;
      padding: 0 7px;
      border-radius: 999px;
      border: 1px solid var(--border-strong);
      background: var(--field);
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      justify-content: center;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    :host([data-tone='accent']) {
      border-color: var(--accent);
      background: var(--accent);
      color: var(--accent-ink);
    }
    :host([data-tone='success']) {
      border-color: var(--success-border);
      background: var(--success-bg);
      color: var(--success);
    }
    :host([data-tone='warning']) {
      border-color: var(--warning);
      color: var(--warning);
      background: transparent;
    }
    :host([data-tone='danger']) {
      border-color: var(--error-border);
      background: var(--error-bg);
      color: var(--error);
    }
  `,
  host: { '[attr.data-tone]': 'tone()' },
})
export class Badge {
  readonly tone = input<BadgeTone>('neutral');
}
