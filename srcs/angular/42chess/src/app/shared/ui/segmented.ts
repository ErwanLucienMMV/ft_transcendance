import { Component, ElementRef, inject, input, model } from '@angular/core';
import { Icon, IconName } from './icon';

export interface SegmentOption<T> {
  value: T;
  label: string;
  icon?: IconName;
}

/**
 * One choice among a few, shown side by side (a radio group). Arrow keys move the choice,
 * as in any radio group, and only the chosen option is a tab stop.
 */
@Component({
  selector: 'app-segmented',
  imports: [Icon],
  template: `
    <div class="segmented" role="radiogroup" [attr.aria-label]="label()">
      @for (option of options(); track option.value; let index = $index) {
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="option.value === value()"
          [attr.tabindex]="option.value === value() ? 0 : -1"
          [attr.data-value]="option.value"
          (click)="value.set(option.value)"
          (keydown)="move($event, index)"
        >
          @if (option.icon) {
            <app-icon [name]="option.icon" />
          }
          {{ option.label }}
        </button>
      }
    </div>
  `,
  styles: `
    .segmented {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--field);
    }
    button {
      min-height: 34px;
      padding: 6px 12px;
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      font-size: 13px;
    }
    button:hover {
      background: var(--field-hover);
      color: var(--text);
    }
    button[aria-checked='true'] {
      background: var(--accent);
      color: var(--accent-ink);
    }
  `,
})
export class Segmented<T> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly options = input.required<readonly SegmentOption<T>[]>();
  readonly label = input.required<string>();
  readonly value = model.required<T>();

  move(event: KeyboardEvent, index: number): void {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    const options = this.options();
    let next: number | undefined;
    if (step) next = (index + step + options.length) % options.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    this.value.set(options[next].value);
    this.host.nativeElement.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }
}
