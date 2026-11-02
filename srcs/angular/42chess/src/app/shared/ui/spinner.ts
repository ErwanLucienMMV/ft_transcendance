import { Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Something is loading; the label is read out and may be shown beside the ring. */
@Component({
  selector: 'app-spinner',
  imports: [TranslocoPipe],
  template: `<span class="ring" aria-hidden="true"></span
    ><span [class.sr-only]="!showLabel()">{{ label() ?? ('common.loading' | transloco) }}</span>`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
    }
    .ring {
      width: 18px;
      height: 18px;
      border: 2px solid var(--border-strong);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .ring {
        animation-duration: 2.4s;
      }
    }
  `,
  host: { role: 'status' },
})
export class Spinner {
  /** Default: "Loading…" in the language shown. */
  readonly label = input<string | null>(null);
  readonly showLabel = input(false);
}
