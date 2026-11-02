import { Component, computed, input } from '@angular/core';
import type { PresenceStatus } from '../features/social/users-api';
import { tr } from '../core/i18n/i18n';

/** Coloured dot plus a word, so the state never relies on colour alone. */
@Component({
  selector: 'app-presence-badge',
  template: `<span class="dot" aria-hidden="true"></span>{{ label() }}`,
  host: { class: 'presence', '[attr.data-status]': 'status()' },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--muted);
      white-space: nowrap;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--border);
    }
    :host([data-status='ONLINE']) .dot {
      background: var(--accent);
    }
    :host([data-status='IN_GAME']) .dot {
      background: #f2c14e;
    }
  `,
})
export class PresenceBadge {
  readonly status = input.required<PresenceStatus>();
  readonly label = computed(() => tr(`shared.presence.${this.status()}`));
}
