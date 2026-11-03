import { Component, input, output } from '@angular/core';
import { Icon } from './icon';

/** Previous and next pages of a long list, with where the reader is. Hidden for one page. */
@Component({
  selector: 'app-pager',
  imports: [Icon],
  template: `
    @if (pages() > 1) {
      <nav class="pager" [attr.aria-label]="label()">
        <button
          type="button"
          class="button secondary"
          [disabled]="page() <= 1"
          (click)="pageChange.emit(page() - 1)"
        >
          <app-icon name="chevron-left" />Previous
        </button>
        <span aria-current="page">Page {{ page() }} of {{ pages() }}</span>
        <button
          type="button"
          class="button secondary"
          [disabled]="page() >= pages()"
          (click)="pageChange.emit(page() + 1)"
        >
          Next<app-icon name="chevron-right" />
        </button>
      </nav>
    }
  `,
  styles: `
    .pager {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-top: 16px;
    }
    span {
      color: var(--muted);
      font-size: 14px;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class Pager {
  /** One-based. */
  readonly page = input.required<number>();
  readonly pages = input.required<number>();
  readonly label = input('Pages');
  readonly pageChange = output<number>();
}
