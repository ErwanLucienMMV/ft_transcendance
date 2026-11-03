import { Component, computed, input, output } from '@angular/core';
import { Icon, IconName } from './icon';

export type Tone = 'error' | 'warning' | 'success' | 'info';
const TONE_ICONS: Record<Tone, IconName> = {
  error: 'alert',
  warning: 'alert',
  success: 'check',
  info: 'info',
};

/**
 * A message about the page: an error or a warning interrupts screen readers (`alert`), a
 * success or a note waits for them (`status`). The content is projected, actions included.
 */
@Component({
  selector: 'app-alert',
  imports: [Icon],
  template: `
    <app-icon class="alert-icon" [name]="icon()" />
    <div class="alert-body">
      @if (heading(); as text) {
        <strong>{{ text }}</strong>
      }
      <ng-content />
    </div>
    @if (dismissible()) {
      <button
        type="button"
        class="ghost small dismiss"
        aria-label="Dismiss"
        (click)="dismissed.emit()"
      >
        <app-icon name="close" />
      </button>
    }
  `,
  host: {
    class: 'alert',
    '[attr.data-tone]': 'tone()',
    '[attr.role]': "tone() === 'error' || tone() === 'warning' ? 'alert' : 'status'",
  },
})
export class Alert {
  readonly tone = input<Tone>('error');
  readonly heading = input<string | null>(null);
  readonly dismissible = input(false);
  readonly dismissed = output<void>();
  readonly icon = computed(() => TONE_ICONS[this.tone()]);
}
