import { Component, computed, input } from '@angular/core';

/**
 * The interface icons, drawn on a 24-pixel grid with a 2-pixel stroke so that they sit with
 * the text around them. The chess pieces have their own sprite (`/chess-pieces.svg`).
 */
export const ICONS = {
  alert: 'M12 3 2 21h20L12 3zM12 10v4.5M12 17.5v.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 11v6M12 7.5v.01',
  check: 'M5 12.5 9.5 17 19 7.5',
  close: 'M6 6l12 12M18 6 6 18',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  first: 'M17 5l-7 7 7 7M7 5v14',
  last: 'M7 5l7 7-7 7M17 5v14',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14M16 5v14',
  flip: 'M4 10a8 8 0 0 1 14-4.5L20 7.5M20 3v4.5h-4.5M20 14a8 8 0 0 1-14 4.5L4 16.5M4 21v-4.5h4.5',
  rematch: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  board: 'M4 4h16v16H4zM4 12h16M12 4v16',
  message: 'M4 5h16v11H9l-5 4z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8zM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  system: 'M3 5h18v11H3zM8 20h8M12 16v4',
  volume: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7',
  mute: 'M4 9v6h4l5 4V5L8 9zM17 9.5l5 5M22 9.5l-5 5',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
} as const;
export type IconName = keyof typeof ICONS;

/** A decorative icon: the control or text next to it carries the meaning for screen readers. */
@Component({
  selector: 'app-icon',
  template: `<svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path [attr.d]="path()" />
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: 1.15em;
      height: 1.15em;
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
  host: { '[attr.data-icon]': 'name()' },
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly path = computed(() => ICONS[this.name()]);
}
